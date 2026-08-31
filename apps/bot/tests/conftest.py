"""Фикстуры тестов бота.

Ни сети, ни Redis, ни Telegram: проверяются наши обработчики, а не чужие
библиотеки. Клиент API подменяется поддельным, хранилище привязок — словарём в
памяти, ответы бота собираются в список.

Диспетчер при этом настоящий, со всеми роутерами и middleware: порядок роутеров
и фильтры — часть поведения, и подменять их значило бы тестировать не то, что
работает.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pytest
from aiogram.fsm.storage.memory import MemoryStorage

from bot.api import BotApiError, LinkVerified
from bot.config import BotSettings
from bot.main import build_dispatcher
from bot.storage import Binding

PATIENT_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
LINK_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
SECRET = "test-binding-secret"
PATIENT_NAME = "Амина"
CHAT_ID = 4242


@dataclass
class FakeApi:
    """Поддельный клиент API: записывает вызовы и отдаёт заготовленные ответы."""

    logs: list[dict[str, Any]] = field(default_factory=list)
    verified: LinkVerified | None = None
    verify_error: BotApiError | None = None
    #: Код, дошедший до API. None — обмена не было вовсе.
    verified_code: str | None = None
    log_error: Exception | None = None
    #: План дня для сценария «Еда»; None — меню не составлено.
    menu: dict[str, Any] | None = None
    menu_error: Exception | None = None
    eaten: list[str] = field(default_factory=list)
    eaten_error: Exception | None = None
    #: Схема терапии для сценария «Лекарства».
    medications: list[dict[str, Any]] = field(default_factory=list)
    medications_error: Exception | None = None

    async def verify_link_code(self, *, code: str, chat_id: int) -> LinkVerified:
        self.verified_code = code
        if self.verify_error is not None:
            raise self.verify_error
        assert self.verified is not None, "тест обязан задать ответ verify_link_code"
        return self.verified

    async def create_log(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        kind: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        if self.log_error is not None:
            raise self.log_error
        self.logs.append(
            {
                "link_id": link_id,
                "secret": secret,
                "patient_id": patient_id,
                "kind": kind,
                "payload": payload,
            }
        )
        return {"id": str(uuid.uuid4())}

    async def get_menu(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        day: date,
    ) -> dict[str, Any] | None:
        if self.menu_error is not None:
            raise self.menu_error
        return self.menu

    async def active_medications(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        day: date,
    ) -> list[dict[str, Any]]:
        if self.medications_error is not None:
            raise self.medications_error
        return self.medications

    async def mark_eaten(
        self, *, link_id: uuid.UUID, secret: str, patient_id: uuid.UUID, item_id: str
    ) -> dict[str, Any]:
        if self.eaten_error is not None:
            raise self.eaten_error
        self.eaten.append(item_id)
        return {"id": item_id, "eaten": True}

    def forget_session(self, link_id: uuid.UUID) -> None:  # pragma: no cover - не нужен тестам
        pass


class FakeStore:
    """Хранилище привязок в памяти с тем же интерфейсом, что у BindingStore."""

    def __init__(self) -> None:
        self._data: dict[int, Binding] = {}

    async def get(self, chat_id: int) -> Binding | None:
        return self._data.get(chat_id)

    async def put(self, chat_id: int, binding: Binding) -> None:
        self._data[chat_id] = binding

    async def delete(self, chat_id: int) -> None:
        self._data.pop(chat_id, None)


@pytest.fixture
def api() -> FakeApi:
    return FakeApi(
        verified=LinkVerified(
            link_id=LINK_ID,
            patient_id=PATIENT_ID,
            patient_name=PATIENT_NAME,
            secret=SECRET,
        )
    )


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def linked_store(store: FakeStore) -> FakeStore:
    store._data[CHAT_ID] = Binding(
        link_id=LINK_ID, secret=SECRET, patient_id=PATIENT_ID, patient_name=PATIENT_NAME
    )
    return store


@pytest.fixture
def dispatcher(api: FakeApi, store: FakeStore):
    return build_dispatcher(  # type: ignore[arg-type]
        storage=MemoryStorage(),
        api=api,
        store=store,
        settings=BotSettings(bot_token="t", bot_api_token="s"),
    )
