"""Приглашения: только админ приглашает, токен одноразовый (раздел 5.3 ТЗ)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from core.models import AuditLog
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
        body = verify.json()
        assert body["tokens"]["access_token"], "после подтверждения выдаётся рабочая сессия"
        # Резервные коды выдаются здесь же и только здесь: это единственный
        # момент, когда их можно показать (в базе только sha256).
        assert body["backup_codes"], "вместе с 2FA выдаётся набор резервных кодов"

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


class TestInvitationList:
    """Списка выданных приглашений не было вовсе.

    Ссылка показывается один раз и не восстанавливается, поэтому вопрос «я уже
    приглашал эту семью?» оставался без ответа.
    """

    async def _invite(self, client, inviter, auth_headers, email: str, role: str = "parent"):
        response = await client.post(
            "/api/v1/auth/invitations",
            json={"email": email, "role": role},
            headers=auth_headers(inviter),
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def test_doctor_sees_only_own_invitations(self, client, session, make_user, auth_headers):
        """Список адресов чужих семей — сведения о пациентах другого специалиста."""

        mine = await make_user(UserRole.DOCTOR)
        other = await make_user(UserRole.DOCTOR)

        await self._invite(client, mine, auth_headers, "my.family@example.com")
        await self._invite(client, other, auth_headers, "other.family@example.com")

        response = await client.get("/api/v1/auth/invitations", headers=auth_headers(mine))

        assert response.status_code == 200, response.text
        emails = [item["email"] for item in response.json()["items"]]
        assert emails == ["my.family@example.com"]

    async def test_admin_sees_all_and_who_invited(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        await self._invite(client, doctor, auth_headers, "family@example.com")

        response = await client.get("/api/v1/auth/invitations", headers=auth_headers(admin))

        items = response.json()["items"]
        assert any(item["email"] == "family@example.com" for item in items)
        # «Кто-то» администратора не устраивает: приглашение семьи делает автора
        # её ведущим специалистом.
        invited = next(i for i in items if i["email"] == "family@example.com")
        assert invited["invited_by_name"] == doctor.full_name

    async def test_token_is_never_listed(self, client, session, make_user, auth_headers):
        """Иначе список сам становится способом войти чужой учётной записью."""

        admin = await make_user(UserRole.ADMIN)
        await self._invite(client, admin, auth_headers, "staff@example.com", role="doctor")

        response = await client.get("/api/v1/auth/invitations", headers=auth_headers(admin))

        assert all("token" not in item for item in response.json()["items"])

    async def test_status_reflects_acceptance(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        created = await self._invite(
            client, admin, auth_headers, "accepts@example.com", role="doctor"
        )

        await client.post(
            "/api/v1/auth/invitations/accept",
            json={
                "token": created["token"],
                "full_name": "Новый Врач",
                "password": STRONG_PASSWORD,
            },
        )

        response = await client.get("/api/v1/auth/invitations", headers=auth_headers(admin))
        item = next(i for i in response.json()["items"] if i["id"] == created["id"])
        assert item["status"] == "accepted"

    async def test_family_cannot_read_the_list(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        response = await client.get("/api/v1/auth/invitations", headers=auth_headers(parent))
        assert response.status_code == 403


class TestRevokeInvitation:
    """Отозвать выданную ссылку было нечем.

    Ошибка в адресе означала действующее приглашение в чужой почтовый ящик, и
    единственным выходом было ждать неделю, пока оно истечёт.
    """

    async def test_revoked_link_stops_working(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "typo@example.com", "role": "doctor"},
            headers=auth_headers(admin),
        )
        invitation = created.json()

        revoked = await client.post(
            f"/api/v1/auth/invitations/{invitation['id']}/revoke",
            headers=auth_headers(admin),
        )
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()["status"] == "revoked"

        # Главное: ссылка перестала работать, а не только пропала из списка.
        accepted = await client.post(
            "/api/v1/auth/invitations/accept",
            json={
                "token": invitation["token"],
                "full_name": "Кто-то",
                "password": STRONG_PASSWORD,
            },
        )
        assert accepted.status_code in (400, 404, 422), accepted.text

    async def test_accepted_invitation_cannot_be_revoked(
        self, client, session, make_user, auth_headers
    ):
        """Учётная запись уже создана: отзыв ссылки её не отключит."""

        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "already@example.com", "role": "doctor"},
            headers=auth_headers(admin),
        )
        invitation = created.json()

        await client.post(
            "/api/v1/auth/invitations/accept",
            json={
                "token": invitation["token"],
                "full_name": "Врач",
                "password": STRONG_PASSWORD,
            },
        )

        response = await client.post(
            f"/api/v1/auth/invitations/{invitation['id']}/revoke",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409, response.text

    async def test_someone_elses_invitation_is_not_found(
        self, client, session, make_user, auth_headers
    ):
        """Чужое приглашение недоступно даже на чтение — значит, и на отзыв."""

        mine = await make_user(UserRole.DOCTOR)
        other = await make_user(UserRole.DOCTOR)
        created = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "not.yours@example.com", "role": "parent"},
            headers=auth_headers(other),
        )

        response = await client.post(
            f"/api/v1/auth/invitations/{created.json()['id']}/revoke",
            headers=auth_headers(mine),
        )
        assert response.status_code == 404

    async def test_revoke_is_audited(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        created = await client.post(
            "/api/v1/auth/invitations",
            json={"email": "audited@example.com", "role": "doctor"},
            headers=auth_headers(admin),
        )

        await client.post(
            f"/api/v1/auth/invitations/{created.json()['id']}/revoke",
            headers=auth_headers(admin),
        )

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "invitations",
                AuditLog.action == "revoke",
                AuditLog.entity_id == uuid.UUID(created.json()["id"]),
            )
        )
        assert entry is not None, "операции с учётными записями пишутся в журнал"
