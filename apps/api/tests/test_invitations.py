"""Приглашения: только админ приглашает, токен одноразовый (раздел 5.3 ТЗ)."""

from __future__ import annotations

import pytest

from core.models.enums import UserRole
from core.repositories import invitations as invitations_repo

pytestmark = pytest.mark.asyncio

STRONG_PASSWORD = "correct horse battery staple"


class TestCreateInvitation:
    async def test_admin_can_invite(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "new.doctor@example.com", "role": "doctor"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["email"] == "new.doctor@example.com"
        assert body["token"], "токен возвращается один раз при создании"

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.PARENT, UserRole.DIETITIAN])
    async def test_non_admin_cannot_invite(self, client, session, make_user, auth_headers, role):
        user = await make_user(role)
        response = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "x@example.com", "role": "doctor"},
            headers=auth_headers(user),
        )
        assert response.status_code == 403

    async def test_invite_requires_auth(self, client):
        response = await client.post(
            "/api/v1/auth/invitations", json={"email": "x@example.com", "role": "doctor"}
        )
        assert response.status_code == 401

    async def test_duplicate_email_conflicts(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        existing = await make_user(UserRole.DOCTOR)
        response = await client.post(
            "/api/v1/auth/invitations",
            json={"email": existing.email, "role": "doctor"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"

    async def test_token_is_not_stored_in_plaintext(self, client, session, make_user, auth_headers):
        """В БД лежит только хеш: дамп базы не должен позволять принять приглашение."""
        admin = await make_user(UserRole.ADMIN)
        response = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "hash.check@example.com", "role": "doctor"},
            headers=auth_headers(admin),
        )
        token = response.json()["token"]
        invitation = await invitations_repo.get(session, response.json()["id"])
        assert invitation is not None
        assert invitation.token_hash != token
        assert token not in invitation.token_hash


class TestAcceptInvitation:
    async def _invite(self, client, session, make_user, auth_headers, email="acc@example.com"):
        admin = await make_user(UserRole.ADMIN)
        response = await client.post(
            "/api/v1/auth/invitations",
            json={"email": email, "role": "doctor"},
            headers=auth_headers(admin),
        )
        return response.json()["token"]

    async def test_accept_creates_user_with_invited_role(
        self, client, session, make_user, auth_headers
    ):
        token = await self._invite(client, session, make_user, auth_headers)
        response = await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "Новый Врач", "password": STRONG_PASSWORD},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["role"] == "doctor"
        assert body["email"] == "acc@example.com"

    async def test_token_single_use(self, client, session, make_user, auth_headers):
        token = await self._invite(client, session, make_user, auth_headers)
        payload = {"token": token, "full_name": "Первый", "password": STRONG_PASSWORD}

        first = await client.post("/api/v1/auth/invitations/accept", json=payload)
        second = await client.post(
            "/api/v1/auth/invitations/accept", json={**payload, "full_name": "Второй"}
        )
        assert first.status_code == 201
        assert second.status_code == 404, "повторное использование токена должно отклоняться"

    async def test_unknown_token_rejected(self, client):
        response = await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": "totally-made-up", "full_name": "X", "password": STRONG_PASSWORD},
        )
        assert response.status_code == 404

    async def test_weak_password_rejected(self, client, session, make_user, auth_headers):
        token = await self._invite(client, session, make_user, auth_headers)
        response = await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "X", "password": "short"},
        )
        assert response.status_code == 422

    async def test_accepted_doctor_can_complete_first_login(
        self, client, session, make_user, auth_headers
    ):
        """Приглашённый врач должен суметь дойти до рабочей сессии.

        2FA для роли doctor обязательна (раздел 5.2 ТЗ), но настроить её до
        первого входа негде — поэтому login отдаёт `totp_setup_required` и
        краткоживущий токен, которым завершается настройка. Раньше здесь был
        тупик: 403 «настройте 2FA» при единственной ручке настройки, требующей
        уже действующей сессии.
        """
        import pyotp

        token = await self._invite(client, session, make_user, auth_headers)
        await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "Врач", "password": STRONG_PASSWORD},
        )

        first = await client.post(
            "/api/v1/auth/login",
            json={"email": "acc@example.com", "password": STRONG_PASSWORD},
        )
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["status"] == "totp_setup_required"
        assert body["tokens"] is None, "рабочие токены до настройки 2FA не выдаются"
        setup_token = body["totp_setup_token"]

        setup = await client.post(
            "/api/v1/auth/totp/setup",
            json={},
            headers={"Authorization": f"Bearer {setup_token}"},
        )
        assert setup.status_code == 200, setup.text
        secret = setup.json()["secret"]

        verify = await client.post(
            "/api/v1/auth/totp/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers={"Authorization": f"Bearer {setup_token}"},
        )
        assert verify.status_code == 200, verify.text
        assert verify.json()["access_token"], "после подтверждения выдаётся рабочая сессия"

        second = await client.post(
            "/api/v1/auth/login",
            json={
                "email": "acc@example.com",
                "password": STRONG_PASSWORD,
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert second.status_code == 200
        assert second.json()["status"] == "ok"

    async def test_setup_token_cannot_access_other_endpoints(
        self, client, session, make_user, auth_headers
    ):
        """Токен настройки 2FA не должен работать как обычный access-токен."""
        import uuid as _uuid

        token = await self._invite(client, session, make_user, auth_headers)
        await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "Врач", "password": STRONG_PASSWORD},
        )
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "acc@example.com", "password": STRONG_PASSWORD},
        )
        setup_token = login.json()["totp_setup_token"]
        headers = {"Authorization": f"Bearer {setup_token}"}

        assert (await client.get("/api/v1/patients", headers=headers)).status_code == 401
        assert (
            await client.get(f"/api/v1/patients/{_uuid.uuid4()}", headers=headers)
        ).status_code == 401
        assert (await client.get("/api/v1/products", headers=headers)).status_code == 401
