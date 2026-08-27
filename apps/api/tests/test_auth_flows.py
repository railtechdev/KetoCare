"""Сценарии `/auth`: вход, 2FA, refresh, ограничение частоты (разделы 5.2, 11 ТЗ)."""

from __future__ import annotations

import pyotp
import pytest

from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio

PASSWORD = "correct horse battery staple"


class TestLogin:
    async def test_parent_logs_in_without_totp(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ok"
        assert body["tokens"]["access_token"]

    async def test_wrong_password_rejected(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": "wrong-password"}
        )
        assert response.status_code == 401

    async def test_unknown_email_and_wrong_password_are_indistinguishable(
        self, client, session, make_user
    ):
        """Ответы не должны позволять перебирать существующие учётные записи."""
        parent = await make_user(UserRole.PARENT)

        unknown = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody-here@example.com", "password": PASSWORD},
        )
        wrong = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": "wrong-password"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json()

    async def test_disabled_account_indistinguishable_from_wrong_password(
        self, client, session, make_user
    ):
        """Отдельный ответ для отключённой учётки подтверждал бы, что email существует."""
        disabled = await make_user(UserRole.PARENT, is_active=False)
        response = await client.post(
            "/api/v1/auth/login", json={"email": disabled.email, "password": PASSWORD}
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_doctor_with_totp_requires_code(self, client, session, make_user):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        without = await client.post(
            "/api/v1/auth/login", json={"email": doctor.email, "password": PASSWORD}
        )
        assert without.status_code == 401

        wrong_code = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "totp_code": "000000"},
        )
        assert wrong_code.status_code == 401

        with_code = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": PASSWORD,
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert with_code.status_code == 200
        assert with_code.json()["status"] == "ok"

    async def test_parent_who_enabled_totp_must_supply_code(self, client, session, make_user):
        """Для родителя 2FA опциональна, но если включена — обязательна при входе."""
        secret = pyotp.random_base32()
        parent = await make_user(UserRole.PARENT, totp_secret=secret)

        without = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        assert without.status_code == 401


class TestTotpChange:
    async def test_changing_existing_totp_requires_current_code(
        self, client, session, make_user, auth_headers
    ):
        """Угнанный access-токен не должен позволять молча заменить второй фактор."""
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        headers = auth_headers(doctor)

        without_code = await client.post("/api/v1/auth/totp/setup", json={}, headers=headers)
        assert without_code.status_code == 401

        with_code = await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(secret).now()},
            headers=headers,
        )
        assert with_code.status_code == 200

    async def test_pending_secret_does_not_replace_active_until_verified(
        self, client, session, make_user, auth_headers
    ):
        """До подтверждения действующий второй фактор продолжает работать."""
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(secret).now()},
            headers=auth_headers(doctor),
        )

        await session.refresh(doctor)
        assert doctor.totp_secret == secret, "старый секрет не меняется до verify"
        assert doctor.totp_pending_secret is not None

    async def test_verify_activates_new_secret(self, client, session, make_user, auth_headers):
        old_secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=old_secret)
        headers = auth_headers(doctor)

        setup = await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(old_secret).now()},
            headers=headers,
        )
        new_secret = setup.json()["secret"]

        verified = await client.post(
            "/api/v1/auth/totp/verify",
            json={"code": pyotp.TOTP(new_secret).now()},
            headers=headers,
        )
        assert verified.status_code == 200

        await session.refresh(doctor)
        assert doctor.totp_secret == new_secret
        assert doctor.totp_pending_secret is None

    async def test_verify_with_wrong_code_rejected(self, client, session, make_user, auth_headers):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        headers = auth_headers(doctor)
        await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(secret).now()},
            headers=headers,
        )

        response = await client.post(
            "/api/v1/auth/totp/verify", json={"code": "000000"}, headers=headers
        )
        assert response.status_code == 401

        await session.refresh(doctor)
        assert doctor.totp_secret == secret, "неверный код не активирует новый секрет"


class TestRefresh:
    async def test_refresh_returns_new_pair(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        refresh_token = login.json()["tokens"]["refresh_token"]

        response = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        assert response.status_code == 200, response.text
        assert response.json()["access_token"]

    async def test_access_token_not_accepted_as_refresh(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        access_token = login.json()["tokens"]["access_token"]

        response = await client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})
        assert response.status_code == 401

    async def test_missing_token_rejected(self, client):
        response = await client.post("/api/v1/auth/refresh", json={})
        assert response.status_code == 401


class TestRateLimiting:
    """Раздел 11 ТЗ: `/auth/*` — 5 запросов в минуту на IP.

    Без лимита `POST /auth/login` открыт для перебора пароля и шестизначного
    TOTP-кода.
    """

    async def test_login_is_rate_limited(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        payload = {"email": parent.email, "password": "wrong-password"}

        statuses = [
            (await client.post("/api/v1/auth/login", json=payload)).status_code for _ in range(7)
        ]

        assert 429 in statuses, f"перебор пароля не ограничивается: {statuses}"
        assert statuses.index(429) >= 5, f"лимит сработал раньше 5 попыток: {statuses}"

    async def test_rate_limited_response_uses_standard_error_shape(
        self, client, session, make_user
    ):
        parent = await make_user(UserRole.PARENT)
        payload = {"email": parent.email, "password": "wrong-password"}

        response = None
        for _ in range(8):
            response = await client.post("/api/v1/auth/login", json=payload)
            if response.status_code == 429:
                break

        assert response is not None and response.status_code == 429
        error = response.json()["error"]
        assert error["code"] == "rate_limited"
        assert isinstance(error["message"], str) and error["message"]
