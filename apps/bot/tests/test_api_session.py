"""Сессия бота у API: 401 по токену — переспросить, а не «попробуйте позже».

Аудит семейного канала 26.11.2026, 2.22: закрытый доступ сервер отвечает 401
на каждый запрос, а бот до конца жизни кешированного токена говорил «Не
удалось сохранить» и давал «Повторить» впустую.
"""

from __future__ import annotations

import uuid

import httpx
import pytest

from bot.api import BotApi, LinkRevokedError

PATIENT = uuid.uuid4()


def _client(handler) -> httpx.AsyncClient:  # type: ignore[no-untyped-def]
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://api")


@pytest.mark.asyncio
async def test_closed_access_is_reported_as_closed_at_once() -> None:
    revoked = False

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/bot/session"):
            if revoked:
                return httpx.Response(401, json={"error": {"code": "unauthorized"}})
            return httpx.Response(200, json={"access_token": "t1", "expires_in": 900})
        if revoked:
            return httpx.Response(401, json={"error": {"code": "unauthorized"}})
        return httpx.Response(201, json={"id": "log"})

    link = uuid.uuid4()
    async with _client(handler) as http:
        api = BotApi(http, service_token="s")
        await api.create_log(
            link_id=link,
            secret="x",
            patient_id=PATIENT,
            kind="weight",
            payload={},
            idempotency_key="k1",
        )
        revoked = True
        with pytest.raises(LinkRevokedError):
            await api.create_log(
                link_id=link,
                secret="x",
                patient_id=PATIENT,
                kind="weight",
                payload={},
                idempotency_key="k2",
            )


@pytest.mark.asyncio
async def test_expired_token_is_renewed_and_the_request_repeated() -> None:
    tokens = iter(["old", "new"])
    seen: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/bot/session"):
            return httpx.Response(200, json={"access_token": next(tokens), "expires_in": 900})
        seen.append(request.headers["Authorization"])
        if request.headers["Authorization"] == "Bearer old":
            return httpx.Response(401, json={"error": {"code": "unauthorized"}})
        return httpx.Response(201, json={"id": "log"})

    async with _client(handler) as http:
        api = BotApi(http, service_token="s")
        created = await api.create_log(
            link_id=uuid.uuid4(),
            secret="x",
            patient_id=PATIENT,
            kind="weight",
            payload={},
            idempotency_key="k1",
        )

    assert created == {"id": "log"}
    assert seen == ["Bearer old", "Bearer new"]
