"""Куки сессии и поверхность API (раздел 11 ТЗ, security-проход п. 23).

Тестов на это не было ни одного при тысяче с лишним остальных — и именно поэтому
пункт 3 чек-листа держался на честном слове: правило записано в ТЗ, в CLAUDE.md и
в комментарии к функции, а в исполняемом виде не существовало нигде.

Заголовки nginx отсюда не проверить — их ставит не приложение. Их проверяет
`check_headers` в `infra/scripts/deploy.sh` после каждого выката.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.config import get_settings
from core.models.enums import UserRole

from .conftest import TEST_PASSWORD

pytestmark = pytest.mark.asyncio


def _cookie_header(response, name: str) -> str:
    for raw in response.headers.get_list("set-cookie"):
        if raw.startswith(f"{name}="):
            return raw
    raise AssertionError(f"В ответе нет куки {name}: {response.headers.get_list('set-cookie')}")


class TestAuthCookies:
    async def test_login_sets_both_cookies_with_the_required_flags(
        self, client, session, make_user
    ):
        """httpOnly, secure, samesite=lax — дословно раздел 11 ТЗ."""

        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/auth/login", json={"email": user.email, "password": TEST_PASSWORD}
        )

        assert response.status_code == 200, response.text
        for name in ("access_token", "refresh_token"):
            raw = _cookie_header(response, name).lower()
            assert "httponly" in raw, f"{name} без HttpOnly — токен виден скриптам страницы"
            assert "secure" in raw, f"{name} без Secure — уедет по http"
            assert "samesite=lax" in raw, f"{name} без SameSite — поедет с чужого сайта"

    async def test_cookies_outlive_the_browser_session(self, client, session, make_user):
        """У куки есть срок жизни, и он равен сроку токена.

        Без `max_age` кука сессионная: refresh-токен подписан на тридцать дней, а
        на деле сессия жила до закрытия браузера. Тесты этого не замечали —
        внутри прогона кука существует всегда.
        """

        from api.security import ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL

        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/auth/login", json={"email": user.email, "password": TEST_PASSWORD}
        )

        access = _cookie_header(response, "access_token").lower()
        refresh = _cookie_header(response, "refresh_token").lower()
        assert f"max-age={int(ACCESS_TOKEN_TTL.total_seconds())}" in access
        assert f"max-age={int(REFRESH_TOKEN_TTL.total_seconds())}" in refresh

    async def test_cookies_are_host_only(self, client, session, make_user):
        """Без `Domain` — иначе сессия кабинета уехала бы на host Mini App.

        Каналы разведены по хостам сознательно (ADR-0017): у Mini App своя
        сессия, суженная до одного ребёнка. Общая кука свела бы их обратно.
        """

        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/auth/login", json={"email": user.email, "password": TEST_PASSWORD}
        )

        assert "domain=" not in _cookie_header(response, "refresh_token").lower()

    async def test_logout_clears_cookies_with_the_same_attributes(
        self, client, session, make_user, auth_headers
    ):
        """Снимаются тем же набором атрибутов, каким ставились."""

        user = await make_user(UserRole.PARENT)

        response = await client.post("/api/v1/auth/logout", headers=auth_headers(user))

        assert response.status_code == 204
        for name in ("access_token", "refresh_token"):
            raw = _cookie_header(response, name).lower()
            assert "httponly" in raw
            assert "secure" in raw
            assert "samesite=lax" in raw
            # Пустое значение и срок в прошлом — это и есть удаление.
            assert "max-age=0" in raw or "expires=" in raw


class TestSurface:
    async def test_health_says_nothing_about_the_system(self, client):
        """Проверка живости не должна рассказывать версию и окружение."""

        response = await client.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestCors:
    """CORS с учётными данными открыт только кабинету (Н18).

    Mini App ходит в API своим хостом и CORS не нуждается; разрешение его
    источнику к хосту кабинета давало бы скрипту, внедрённому в Mini App, читать
    данные кабинета того же браузера — `tma.` и `app.` один сайт для cookie `lax`.
    """

    @staticmethod
    async def _preflight(client, origin: str):
        return await client.options(
            "/api/v1/users/me",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )

    async def test_cabinet_origin_is_allowed_with_credentials(self, client):
        origin = get_settings().web_origin

        response = await self._preflight(client, origin)

        assert response.headers.get("access-control-allow-origin") == origin
        assert response.headers.get("access-control-allow-credentials") == "true"

    async def test_miniapp_origin_is_not_allowed(self, client):
        origin = get_settings().miniapp_origin
        assert origin != get_settings().web_origin

        preflight = await self._preflight(client, origin)
        simple = await client.get("/health", headers={"Origin": origin})

        assert "access-control-allow-origin" not in preflight.headers
        assert "access-control-allow-origin" not in simple.headers

    def test_miniapp_calls_the_api_on_its_own_host(self):
        """Основание решения: клиент Mini App ходит относительным адресом. Станет
        абсолютным на другой хост — CORS придётся вернуть, и этот тест скажет об
        этом раньше, чем Mini App перестанет открываться."""

        source = (
            Path(__file__).resolve().parents[3] / "apps" / "miniapp" / "src" / "lib" / "api.ts"
        ).read_text(encoding="utf-8")

        assert 'baseUrl: ""' in source
