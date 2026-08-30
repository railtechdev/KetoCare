"""Сброс пароля администратором — вторая половина восстановления доступа.

Восстановления пароля в продукте нет: почтовой рассылки нет вовсе, а
единственная смена требует знать текущий. Забывший пароль врач терял доступ к
данным своих пациентов навсегда.

Тесты безопасности не меньше, чем функциональности: временный пароль знают
двое, и весь смысл признака `password_change_required` в том, что вход по нему
не даёт рабочей сессии.
"""

from __future__ import annotations

import pytest

from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "совершенно новый пароль 42"


def reset_url(user_id) -> str:
    return f"/api/v1/admin/users/{user_id}/reset-password"


async def _reset(client, admin, target, auth_headers) -> str:
    response = await client.post(reset_url(target.id), headers=auth_headers(admin))
    assert response.status_code == 200, response.text
    return response.json()["temporary_password"]


class TestAdminPasswordReset:
    async def test_temporary_password_works_but_gives_no_session(
        self, client, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)

        temporary = await _reset(client, admin, parent, auth_headers)

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": parent.email, "password": temporary},
        )

        assert login.status_code == 200, login.text
        body = login.json()
        # Рабочих токенов здесь быть не должно: временный пароль знает и
        # администратор, и сессия по нему означала бы, что признак не значит
        # ничего.
        assert body["status"] == "password_change_required"
        assert body["tokens"] is None
        assert body["password_reset_token"]

    async def test_old_password_stops_working(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)

        await _reset(client, admin, parent, auth_headers)

        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        assert login.status_code == 401

    async def test_setting_own_password_completes_login(
        self, client, make_user, auth_headers, session
    ):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)
        temporary = await _reset(client, admin, parent, auth_headers)

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": parent.email, "password": temporary},
        )
        reset_token = login.json()["password_reset_token"]

        done = await client.post(
            "/api/v1/auth/password/set",
            json={"new_password": NEW_PASSWORD},
            headers={"Authorization": f"Bearer {reset_token}"},
        )
        assert done.status_code == 200, done.text
        assert done.json()["access_token"]

        # Новый пароль работает и ведёт прямо в кабинет.
        again = await client.post(
            "/api/v1/auth/login",
            json={"email": parent.email, "password": NEW_PASSWORD},
        )
        assert again.json()["status"] == "ok"
        assert again.json()["tokens"]["access_token"]

        await session.refresh(parent)
        assert parent.password_change_required is False

    async def test_temporary_password_dies_with_the_new_one(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)
        temporary = await _reset(client, admin, parent, auth_headers)

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": parent.email, "password": temporary},
        )
        await client.post(
            "/api/v1/auth/password/set",
            json={"new_password": NEW_PASSWORD},
            headers={"Authorization": f"Bearer {login.json()['password_reset_token']}"},
        )

        # Иначе администратор навсегда сохранял бы рабочий пароль от чужой
        # учётной записи.
        stale = await client.post(
            "/api/v1/auth/login",
            json={"email": parent.email, "password": temporary},
        )
        assert stale.status_code == 401

    async def test_cannot_set_the_temporary_password_as_own(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)
        temporary = await _reset(client, admin, parent, auth_headers)

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": parent.email, "password": temporary},
        )

        # Оставить временный своим значило бы сохранить пароль, который знает
        # администратор, — то есть не сменить его вовсе.
        response = await client.post(
            "/api/v1/auth/password/set",
            json={"new_password": temporary},
            headers={"Authorization": f"Bearer {login.json()['password_reset_token']}"},
        )
        assert response.status_code == 422

    async def test_reset_token_does_not_open_the_cabinet(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        temporary = await _reset(client, admin, doctor, auth_headers)

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": temporary},
        )
        reset_token = login.json()["password_reset_token"]

        # Токен сброса подходит только к своей ручке: иначе он был бы обычной
        # сессией, выданной по паролю, который знают двое.
        response = await client.get(
            "/api/v1/users/me", headers={"Authorization": f"Bearer {reset_token}"}
        )
        assert response.status_code == 401

    async def test_second_factor_still_required(self, client, make_user, auth_headers):
        import pyotp

        admin = await make_user(UserRole.ADMIN)
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        temporary = await _reset(client, admin, doctor, auth_headers)

        # Сброс пароля сокращает путь до смены, но не отменяет второго фактора.
        without_code = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": temporary},
        )
        assert without_code.status_code == 401

        with_code = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": temporary,
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert with_code.json()["status"] == "password_change_required"

    async def test_admin_cannot_reset_own_password(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(reset_url(admin.id), headers=auth_headers(admin))

        assert response.status_code == 409

    async def test_doctor_cannot_reset_passwords(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        victim = await make_user(UserRole.PARENT)

        response = await client.post(reset_url(victim.id), headers=auth_headers(doctor))

        assert response.status_code == 403

    async def test_reset_is_audited(self, client, make_user, auth_headers, session):
        from sqlalchemy import select

        from core.models import AuditLog

        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)

        await _reset(client, admin, parent, auth_headers)

        rows = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.entity_id == parent.id, AuditLog.action == "password_reset"
                )
            )
        ).all()
        # Выдача чужого пароля обязана оставлять след (правило 7).
        assert len(rows) == 1
        assert rows[0].user_id == admin.id
