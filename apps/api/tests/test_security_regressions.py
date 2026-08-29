"""Регрессии на находки ревью безопасности.

Каждый тест соответствует подтверждённому дефекту, который прошлые тесты
пропускали структурно.
"""

from __future__ import annotations

import pytest
from starlette.requests import Request

from api.client_address import client_address
from core.models.enums import UserRole


def _request(peer: str | None, headers: dict[str, str] | None = None) -> Request:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": raw_headers,
        "client": (peer, 12345) if peer else None,
    }
    return Request(scope)


class TestClientAddressTrust:
    """X-Forwarded-For заполняет клиент. Доверять ему без списка доверенных прокси
    нельзя: ротацией заголовка обходится ограничение частоты на /auth/*, а в
    audit_log.ip пишется значение, выбранное атакующим."""

    def test_forwarded_header_ignored_from_untrusted_peer(self) -> None:
        request = _request("203.0.113.9", {"X-Forwarded-For": "1.2.3.4"})
        assert client_address(request) == "203.0.113.9", "XFF от недоверенного пира игнорируется"

    def test_forwarded_header_used_from_trusted_proxy(self, monkeypatch) -> None:
        monkeypatch.setattr("api.client_address.trusted_proxies", lambda: frozenset({"10.0.0.1"}))
        request = _request("10.0.0.1", {"X-Forwarded-For": "1.2.3.4, 10.0.0.1"})
        assert client_address(request) == "1.2.3.4"

    def test_empty_forwarded_value_falls_back_to_peer(self, monkeypatch) -> None:
        """Пустой первый элемент не должен давать пустой ключ лимита — иначе все
        такие запросы попадают в одно общее ведро."""
        monkeypatch.setattr("api.client_address.trusted_proxies", lambda: frozenset({"10.0.0.1"}))
        request = _request("10.0.0.1", {"X-Forwarded-For": " , 1.2.3.4"})
        assert client_address(request) == "10.0.0.1"

    def test_no_client_returns_none(self) -> None:
        assert client_address(_request(None)) is None


@pytest.mark.asyncio
class TestRateLimitNotBypassable:
    async def test_rotating_forwarded_header_does_not_bypass_limit(
        self, client, session, make_user
    ):
        """Раньше ротация X-Forwarded-For давала новое ведро на каждый запрос,
        и перебор пароля шёл без ограничений."""
        parent = await make_user(UserRole.PARENT)
        payload = {"email": parent.email, "password": "wrong-password"}

        statuses = []
        for i in range(9):
            response = await client.post(
                "/api/v1/auth/login", json=payload, headers={"X-Forwarded-For": f"1.2.3.{i}"}
            )
            statuses.append(response.status_code)

        assert 429 in statuses, f"подмена заголовка обходит лимит: {statuses}"


@pytest.mark.asyncio
class TestUnhandledErrorEnvelope:
    async def test_unhandled_exception_returns_spec_error_shape(self, client):
        """Непойманное исключение обязано приходить в формате раздела 5.1 ТЗ,
        а не как plain-text Internal Server Error."""
        from api.main import create_app

        app = create_app()

        @app.get("/api/v1/_boom")
        async def _boom() -> None:
            raise RuntimeError("secret detail that must not leak")

        from httpx import ASGITransport, AsyncClient

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            response = await c.get("/api/v1/_boom")

        assert response.status_code == 500
        error = response.json()["error"]
        assert error["code"] == "internal"
        assert "secret detail" not in response.text, "детали исключения наружу не отдаются"
