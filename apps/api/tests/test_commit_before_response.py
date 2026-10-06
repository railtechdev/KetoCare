"""Транзакция запроса фиксируется ДО того, как клиент получил ответ.

У зависимости с `yield` FastAPI по умолчанию (`scope="request"`) выполняет код
после `yield` уже ПОСЛЕ отправки ответа. Для сессии это значит: клиент получает
`201`, тут же перечитывает список — и видит его без только что созданной строки,
потому что `commit()` ещё не случился. Ровно так 06.10.2026 упал сквозной
сценарий: `POST /prescriptions` → 201, следующий `GET /prescriptions` через
22 мс вернул `total: 0`, и история назначения не показала новую версию.

Тестовая сессия в `conftest.py` не коммитит (откат фикстурой), поэтому порядок
проверяется на отдельном приложении с той же `SessionDep`: важна не сессия, а
объявленная у зависимости область.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps.auth import SessionDep, get_session


@pytest.mark.asyncio
async def test_session_closes_before_response_starts() -> None:
    events: list[str] = []

    async def fake_session() -> AsyncIterator[Any]:
        yield object()
        events.append("commit")

    app = FastAPI()
    app.dependency_overrides[get_session] = fake_session

    @app.post("/write")
    async def write(session: SessionDep) -> dict[str, bool]:
        return {"ok": True}

    async def recording_app(scope: Any, receive: Any, send: Any) -> None:
        async def recording_send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                events.append("response")
            await send(message)

        await app(scope, receive, recording_send)

    transport = ASGITransport(app=recording_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/write")

    assert response.status_code == 200
    assert events == ["commit", "response"]
