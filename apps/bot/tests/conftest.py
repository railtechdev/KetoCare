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
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.base import StorageKey
from aiogram.fsm.storage.memory import MemoryStorage

from bot.api import BotApiError, LinkVerified
from bot.config import BotSettings
from bot.main import build_dispatcher
from bot.storage import Binding, BindingStore, _to_json

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
    #: Ключи попыток записи — по одному на вызов `create_log`.
    idempotency_keys: list[str] = field(default_factory=list)
    #: Тела попыток — повтор обязан слать то же самое, байт в байт.
    attempt_bodies: list[dict[str, Any]] = field(default_factory=list)
    #: План дня для сценария «Еда»; None — меню не составлено.
    menu: dict[str, Any] | None = None
    menu_error: Exception | None = None
    eaten: list[str] = field(default_factory=list)
    eaten_error: Exception | None = None
    #: Схема терапии для сценария «Лекарства».
    medications: list[dict[str, Any]] = field(default_factory=list)
    medications_error: Exception | None = None
    #: Справочники для сценария «Приступ».
    seizure_type_items: list[dict[str, Any]] = field(default_factory=list)
    duration_items: list[dict[str, Any]] = field(default_factory=list)
    dictionary_error: Exception | None = None
    #: Кто пришёл в бота: `from_user.id`, а не `chat.id` (ADR-0040).
    verified_telegram_user_id: int | None = None
    #: Ответ `POST /ai/parse` для сценария «Еда словами».
    parsed: dict[str, Any] | None = None
    parse_error: Exception | None = None
    #: Фразы, дошедшие до разбора.
    parsed_texts: list[str] = field(default_factory=list)
    #: Язык человека на сервере (ADR-0052) и что бот туда записал.
    server_language: str | None = None
    language_writes: list[str] = field(default_factory=list)
    language_error: Exception | None = None
    #: Язык, присланный ботом при привязке.
    activation_language: str | None = None

    async def activate_access_code(
        self,
        *,
        code: str,
        chat_id: int,
        telegram_user_id: int,
        first_name: str,
        last_name: str | None,
        language: str | None = None,
    ) -> LinkVerified:
        self.verified_code = code
        self.activation_language = language
        self.verified_telegram_user_id = telegram_user_id
        if self.verify_error is not None:
            raise self.verify_error
        assert self.verified is not None, "тест обязан задать ответ activate_access_code"
        return self.verified

    async def create_log(
        self,
        *,
        link_id: uuid.UUID,
        secret: str,
        patient_id: uuid.UUID,
        kind: str,
        payload: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        self.idempotency_keys.append(idempotency_key)
        self.attempt_bodies.append(payload)
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

    async def seizure_types(self, *, link_id: uuid.UUID, secret: str) -> list[dict[str, Any]]:
        if self.dictionary_error is not None:
            raise self.dictionary_error
        return self.seizure_type_items

    async def duration_options(self, *, link_id: uuid.UUID, secret: str) -> list[dict[str, Any]]:
        if self.dictionary_error is not None:
            raise self.dictionary_error
        return self.duration_items

    async def parse_text(
        self, *, link_id: uuid.UUID, secret: str, patient_id: uuid.UUID, text: str
    ) -> dict[str, Any]:
        self.parsed_texts.append(text)
        if self.parse_error is not None:
            raise self.parse_error
        assert self.parsed is not None, "тест обязан задать ответ parse_text"
        return self.parsed

    async def mark_eaten(
        self, *, link_id: uuid.UUID, secret: str, patient_id: uuid.UUID, item_id: str
    ) -> dict[str, Any]:
        if self.eaten_error is not None:
            raise self.eaten_error
        self.eaten.append(item_id)
        # Позиция помечается и в меню: сценарий после отметки перечитывает план
        # с сервера, и настоящая ручка вернула бы позицию уже съеденной.
        for item in (self.menu or {}).get("items", []):
            if str(item["id"]) == item_id:
                item["eaten"] = True
        return {"id": item_id, "eaten": True}

    def forget_session(self, link_id: uuid.UUID) -> None:  # pragma: no cover - не нужен тестам
        pass

    async def get_language(self, *, link_id: uuid.UUID, secret: str) -> str | None:
        if self.language_error is not None:
            raise self.language_error
        return self.server_language

    async def set_language(self, *, link_id: uuid.UUID, secret: str, language: str) -> None:
        if self.language_error is not None:
            raise self.language_error
        self.language_writes.append(language)
        self.server_language = language


class FakeRedis:
    """Ровно те команды Redis, которыми пользуется `BindingStore`, — в памяти.

    Хранилище в тестах настоящее (`BindingStore`), подделан только Redis: с
    ADR-0048 в хранилище живёт логика — выбранный ребёнок, перенос старой
    раскладки, что остаётся после отзыва, — и подделка самого хранилища
    проверяла бы представления автора о ней, а не её.
    """

    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.values: dict[str, str] = {}

    async def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    async def hset(
        self,
        key: str,
        field: str | None = None,
        value: str | None = None,
        mapping: dict[str, str] | None = None,
    ) -> int:
        target = self.hashes.setdefault(key, {})
        if field is not None and value is not None:
            target[field] = value
        target.update(mapping or {})
        return 1

    async def hsetnx(self, key: str, field: str, value: str) -> int:
        target = self.hashes.setdefault(key, {})
        if field in target:
            return 0
        target[field] = value
        return 1

    async def hdel(self, key: str, *fields: str) -> int:
        target = self.hashes.get(key, {})
        removed = sum(1 for name in fields if target.pop(name, None) is not None)
        if not target:
            self.hashes.pop(key, None)
        return removed

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, nx: bool = False) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def delete(self, *keys: str) -> int:
        removed = 0
        for key in keys:
            removed += int(self.hashes.pop(key, None) is not None)
            removed += int(self.values.pop(key, None) is not None)
        return removed


def FakeStore() -> BindingStore:  # noqa: N802 - прежнее имя фикстуры сохранено
    return BindingStore(FakeRedis())  # type: ignore[arg-type]


def put_binding(store: BindingStore, chat_id: int, binding: Binding) -> None:
    """Кладёт привязку в хранилище синхронно — для синхронных фикстур."""

    redis: FakeRedis = store._redis  # type: ignore[assignment]
    redis.hashes.setdefault(f"bot:bindings:{chat_id}", {})[str(binding.patient_id)] = _to_json(
        binding
    )
    redis.values[f"bot:active:{chat_id}"] = str(binding.patient_id)


@pytest.fixture
def api() -> FakeApi:
    return FakeApi(
        verified=LinkVerified(
            link_id=LINK_ID,
            patient_id=PATIENT_ID,
            patient_name=PATIENT_NAME,
            secret=SECRET,
            web_url="https://app.example",
            has_web_credentials=False,
        )
    )


@pytest.fixture
def store() -> BindingStore:
    return FakeStore()


@pytest.fixture
def linked_store(store: BindingStore) -> BindingStore:
    put_binding(
        store,
        CHAT_ID,
        Binding(link_id=LINK_ID, secret=SECRET, patient_id=PATIENT_ID, patient_name=PATIENT_NAME),
    )
    return store


# Один на весь прогон: роутеры — модульные объекты, и aiogram привязывает
# роутер к диспетчеру навсегда. Второй build_dispatcher в том же процессе
# падает «Router is already attached». Тесты через эту фикстуру проверяют
# маршрутизацию, а не состояние, — общий экземпляр им не мешает.
@pytest.fixture(scope="session")
def dispatcher():
    return build_dispatcher(  # type: ignore[arg-type]
        storage=MemoryStorage(),
        api=FakeApi(),
        store=FakeStore(),
        settings=BotSettings(bot_token="t", bot_api_token="s"),
    )


@pytest.fixture
def state() -> FSMContext:
    """Состояние FSM в памяти — общее для всех тестов сценариев."""

    return FSMContext(
        storage=MemoryStorage(),
        key=StorageKey(bot_id=1, chat_id=CHAT_ID, user_id=CHAT_ID),
    )
