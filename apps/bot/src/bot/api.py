"""Клиент API для бота (раздел 7 ТЗ, ADR-0009).

Собственного доступа к БД у бота нет — только эти вызовы. Аутентификация
двухключевая:

* сервисный токен `BOT_API_TOKEN` в заголовке `X-Bot-Token` — открывает привязку
  и обмен секрета на сессию, и ничего больше;
* секрет привязки — вместе с сервисным токеном меняется на access-токен,
  суженный до одного ребёнка.

Сессии кешируются в памяти процесса: терять их при перезапуске не страшно, бот
просто обменяет секрет заново. Секрет при этом лежит в Redis (`storage.py`) —
вот его терять нельзя.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

# Насколько раньше срока считать сессию истёкшей. Без запаса запрос, ушедший за
# секунду до истечения, доезжал бы до API уже с просроченным токеном.
_EXPIRY_MARGIN = timedelta(seconds=30)


class BotApiError(Exception):
    """Сбой вызова API. `code` — код из раздела 5.1 ТЗ, если API его прислал."""

    def __init__(self, code: str | None, message: str, status: int) -> None:
        self.code = code
        self.message = message
        self.status = status
        super().__init__(f"{status} {code}: {message}")


class LinkRevokedError(BotApiError):
    """Привязка отозвана: секрет больше не открывает сессию."""


@dataclass(frozen=True, slots=True)
class LinkVerified:
    link_id: uuid.UUID
    patient_id: uuid.UUID
    patient_name: str
    secret: str


@dataclass(slots=True)
class _Session:
    token: str
    expires_at: datetime


class BotApi:
    def __init__(self, client: httpx.AsyncClient, *, service_token: str) -> None:
        self._client = client
        self._service_token = service_token
        self._sessions: dict[uuid.UUID, _Session] = {}

    # --- привязка ---

    async def verify_link_code(self, *, code: str, chat_id: int) -> LinkVerified:
        payload = await self._request(
            "POST",
            "/api/v1/auth/link-codes/verify",
            headers={"X-Bot-Token": self._service_token},
            json={"code": code, "chat_id": chat_id},
        )
        return LinkVerified(
            link_id=uuid.UUID(payload["link_id"]),
            patient_id=uuid.UUID(payload["patient_id"]),
            patient_name=payload["patient_name"],
            secret=payload["secret"],
        )

    async def _token(self, *, link_id: uuid.UUID, secret: str) -> str:
        cached = self._sessions.get(link_id)
        if cached is not None and cached.expires_at > datetime.now(UTC):
            return cached.token

        try:
            payload = await self._request(
                "POST",
                "/api/v1/auth/bot/session",
                headers={"X-Bot-Token": self._service_token},
                json={"link_id": str(link_id), "secret": secret},
            )
        except BotApiError as exc:
            if exc.status == 401:
                # Отозванная привязка отвечает так же, как неверный секрет, —
                # различать их API намеренно не даёт. Для бота это одно и то же:
                # секрет больше не работает, нужна новая привязка.
                self._sessions.pop(link_id, None)
                raise LinkRevokedError(exc.code, exc.message, exc.status) from exc
            raise

        token = payload["access_token"]
        self._sessions[link_id] = _Session(
            token=token,
            expires_at=datetime.now(UTC)
            + timedelta(seconds=int(payload["expires_in"]))
            - _EXPIRY_MARGIN,
        )
        return token

    def forget_session(self, link_id: uuid.UUID) -> None:
        self._sessions.pop(link_id, None)

    # --- дневники ---

    async def create_log(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        kind: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Запись в дневник. `kind` — часть пути: ketones, weight, side-effects…

        `source` бот не передаёт и передать не может: канал проставляет сервер по
        токену, иначе запись из чата могла бы объявить себя чем угодно.
        """

        token = await self._token(link_id=link_id, secret=secret)
        return await self._request(
            "POST",
            f"/api/v1/patients/{patient_id}/logs/{kind}",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )

    # --- низкий уровень ---

    async def _request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self._client.request(method, path, headers=headers, json=json)
        if response.is_success:
            body: dict[str, Any] = response.json()
            return body

        code, message = _error_of(response)
        raise BotApiError(code, message, response.status_code)


def _error_of(response: httpx.Response) -> tuple[str | None, str]:
    """Разбирает конверт ошибки раздела 5.1 ТЗ.

    Ответ может и не быть этим конвертом — например, прокси вернул html-страницу
    502. Тогда возвращается статус без кода, а не исключение поверх исключения.
    """

    try:
        error = response.json()["error"]
        return error.get("code"), error.get("message", "")
    except (ValueError, KeyError, TypeError):
        return None, response.text[:200]
