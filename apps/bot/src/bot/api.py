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
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

# Насколько раньше срока считать сессию истёкшей. Без запаса запрос, ушедший за
# секунду до истечения, доезжал бы до API уже с просроченным токеном.
_EXPIRY_MARGIN = timedelta(seconds=30)

#: Ожидание разбора свободного текста — дольше общего таймаута клиента.
#:
#: Ручка `POST /ai/parse` ждёт ответ модели синхронно до 15 секунд (раздел 10.1
#: ТЗ), а общий таймаут бота — 10. С ним бот обрывал бы связь ровно тогда, когда
#: ответ уже в пути, и родитель не увидел бы ничего: `httpx.ReadTimeout` — не
#: `BotApiError`, обработчик до своего сообщения об отказе не дошёл бы.
PARSE_TIMEOUT_S = 16.0


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

        token: str = payload["access_token"]
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

    async def get_menu(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        day: date,
    ) -> dict[str, Any] | None:
        """План дня. `None` — меню на эту дату не составлено.

        Отсутствие меню — обычное состояние, а не сбой: семья могла не
        планировать день. Поэтому 404 разбирается здесь, а не поднимается
        наверх ошибкой.
        """

        token = await self._token(link_id=link_id, secret=secret)
        try:
            return await self._request(
                "GET",
                f"/api/v1/patients/{patient_id}/menus?date={day.isoformat()}",
                headers={"Authorization": f"Bearer {token}"},
            )
        except BotApiError as exc:
            if exc.status == 404:
                return None
            raise

    async def active_medications(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        day: date,
    ) -> list[dict[str, Any]]:
        """Препараты, которые ребёнок принимает в этот день.

        Единственная клиническая ручка, открытая семье, и открыта она ровно ради
        этого сценария: препараты ребёнку даёт родитель, а схему ведёт врач.
        """

        token = await self._token(link_id=link_id, secret=secret)
        body = await self._request(
            "GET",
            f"/api/v1/patients/{patient_id}/medications?active_on={day.isoformat()}",
            headers={"Authorization": f"Bearer {token}"},
        )
        items: list[dict[str, Any]] = body.get("items", [])
        return items

    async def parse_text(
        self, *, link_id: uuid.UUID, secret: str, patient_id: uuid.UUID, text: str
    ) -> dict[str, Any]:
        """Разобрать фразу родителя (раздел 10.3 ТЗ).

        Ничего не сохраняет: ответ — черновик, и записывается он отдельным
        вызовом `create_log` с `ai_job_id`, когда родитель нажмёт
        «Подтвердить». Разбор в дневник сам по себе не попадает.
        """

        token = await self._token(link_id=link_id, secret=secret)
        return await self._request(
            "POST",
            "/api/v1/ai/parse",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": str(patient_id), "text": text},
            # Своё ожидание, дольше общего: ручка ждёт разбор синхронно до 15
            # секунд (раздел 10.1 ТЗ), а клиент бота настроен на 10. С общим
            # таймаутом бот обрывал бы связь раньше ответа — и родитель не
            # увидел бы ни разбора, ни отказа: `httpx.ReadTimeout` — не
            # `BotApiError`, и обработчик до своего сообщения не дошёл бы.
            wait_s=PARSE_TIMEOUT_S,
        )

    async def seizure_types(self, *, link_id: uuid.UUID, secret: str) -> list[dict[str, Any]]:
        """Типы приступов — общий справочник, к пациенту не привязан."""

        token = await self._token(link_id=link_id, secret=secret)
        body = await self._request(
            "GET",
            "/api/v1/dictionaries/seizure-types",
            headers={"Authorization": f"Bearer {token}"},
        )
        items: list[dict[str, Any]] = body.get("items", [])
        return items

    async def duration_options(self, *, link_id: uuid.UUID, secret: str) -> list[dict[str, Any]]:
        """Шкала длительности приступа — та же, что в анкете регистрации.

        Не своя шкала бота: семья отвечает на один и тот же вопрос в кабинете и
        в чате, и два набора формулировок означали бы, что ряды за разные
        месяцы нельзя сравнить между собой (вопрос 23 медицинской команде).
        """

        token = await self._token(link_id=link_id, secret=secret)
        body = await self._request(
            "GET",
            "/api/v1/dictionaries/intake-options?scale=seizure_duration",
            headers={"Authorization": f"Bearer {token}"},
        )
        items: list[dict[str, Any]] = body.get("items", [])
        return items

    async def mark_eaten(
        self, *, link_id: uuid.UUID, secret: str, patient_id: uuid.UUID, item_id: str
    ) -> dict[str, Any]:
        """Отметка «съедено» по позиции плана.

        Второй путь — «Написать словами»: он идёт через `parse_text` и
        `create_log`, потому что съеденное могло не совпасть с планом.
        """

        token = await self._token(link_id=link_id, secret=secret)
        return await self._request(
            "POST",
            f"/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
            headers={"Authorization": f"Bearer {token}"},
            json={"eaten": True},
        )

    # --- низкий уровень ---

    async def _request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any] | None = None,
        wait_s: float | None = None,
    ) -> dict[str, Any]:
        # Имя не `timeout`: это не ожидание корутины, а параметр httpx для
        # одного запроса. `USE_CLIENT_DEFAULT` — сам httpx: он отличает
        # «таймаут не задан» от «таймаут снят», и None означал бы второе.
        response = await self._client.request(
            method,
            path,
            headers=headers,
            json=json,
            timeout=httpx.USE_CLIENT_DEFAULT if wait_s is None else wait_s,
        )
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
