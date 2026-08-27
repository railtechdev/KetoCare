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

    async def test_accepted_user_can_log_in(self, client, session, make_user, auth_headers):
        """Роль doctor требует 2FA, поэтому без настроенного TOTP вход закрыт —
        это ожидаемое поведение раздела 5.2 ТЗ, а не ошибка."""
        token = await self._invite(client, session, make_user, auth_headers)
        await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "Врач", "password": STRONG_PASSWORD},
        )

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "acc@example.com", "password": STRONG_PASSWORD},
        )
        assert response.status_code == 403
        assert "двухфактор" in response.json()["error"]["message"].lower()
