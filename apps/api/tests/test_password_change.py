"""Смена пароля и отзыв сессий (раздел 11 ТЗ).

Тесты безопасности: смысл ревокации в том, что старый токен перестаёт работать.
Проверка «ручка вернула 200» этого не показывает.
"""

from __future__ import annotations

import pytest

from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio

URL = "/api/v1/users/me/password"
NEW_PASSWORD = "totally different passphrase"
TEST_PASSWORD = "correct horse battery staple"


class TestChangePassword:
    async def test_changes_password_and_returns_working_tokens(
        self, client, make_user, auth_headers
    ):
        user = await make_user(UserRole.PARENT)

        response = await client.post(
            URL,
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
            headers=auth_headers(user),
        )

        assert response.status_code == 200, response.text
        issued = response.json()["access_token"]

        # Выданный токен работает сразу: смена пароля не должна выкидывать из
        # приложения того, кто её сделал.
        me = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {issued}"})
        assert me.status_code == 200

    async def test_old_token_stops_working(self, client, make_user, auth_headers):
        # Главное свойство: прежние сессии обрываются. Без этого смена пароля
        # после утечки ничего не даёт — угнанный токен продолжает работать.
        user = await make_user(UserRole.PARENT)
        old = auth_headers(user)

        assert (await client.get("/api/v1/users/me", headers=old)).status_code == 200

        changed = await client.post(
            URL,
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
            headers=old,
        )
        assert changed.status_code == 200

        after = await client.get("/api/v1/users/me", headers=old)
        assert after.status_code == 401
        assert after.json()["error"]["code"] == "unauthorized"

    async def test_old_refresh_token_stops_working(self, client, make_user, auth_headers):
        from api.security import create_token

        user = await make_user(UserRole.PARENT)
        old_refresh = create_token(user_id=user.id, role=user.role, token_type="refresh")

        assert (
            await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        ).status_code == 200

        await client.post(
            URL,
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
            headers=auth_headers(user),
        )

        refreshed = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        assert refreshed.status_code == 401

    async def test_new_password_works_for_login(self, client, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)
        await client.post(
            URL,
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
            headers=auth_headers(user),
        )

        logged_in = await client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": NEW_PASSWORD},
        )
        assert logged_in.status_code == 200, logged_in.text
        assert logged_in.json()["status"] == "ok"

    async def test_wrong_current_password_rejected(self, client, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)

        response = await client.post(
            URL,
            json={"current_password": "не тот пароль", "new_password": NEW_PASSWORD},
            headers=auth_headers(user),
        )

        assert response.status_code == 401
        # И сессия при неудаче остаётся живой: пользователь просто ошибся.
        assert (await client.get("/api/v1/users/me", headers=auth_headers(user))).status_code == 200

    async def test_same_password_rejected(self, client, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)

        response = await client.post(
            URL,
            json={"current_password": TEST_PASSWORD, "new_password": TEST_PASSWORD},
            headers=auth_headers(user),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    @pytest.mark.parametrize("short", ["", "коротко", "12345678901"])
    async def test_short_password_rejected(self, client, make_user, auth_headers, short):
        user = await make_user(UserRole.PARENT)

        response = await client.post(
            URL,
            json={"current_password": TEST_PASSWORD, "new_password": short},
            headers=auth_headers(user),
        )
        assert response.status_code == 422

    async def test_requires_authentication(self, client):
        response = await client.post(
            URL, json={"current_password": "x", "new_password": NEW_PASSWORD}
        )
        assert response.status_code == 401
