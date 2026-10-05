"""Хранилище привязок бота (ADR-0009, ADR-0048).

Здесь лежит второй фактор доступа — секрет привязки, выданный API один раз при
`/start <код>`. Восстановить его нельзя: в БД хранится только sha256, и
восстановление по сервисному токену не предусмотрено намеренно — оно вернуло бы
схему к одному фактору.

Отсюда следствие: хранилище обязано переживать перезапуск бота. Память процесса
не годится — после каждого деплоя все семьи оказались бы отвязаны и должны были
бы заново просить код в кабинете.

С ADR-0048 чат ведёт нескольких детей: у каждого своя привязка и свой секрет, а
чат помнит, какой ребёнок выбран сейчас. Каждая запись дневника уходит с
секретом ВЫБРАННОГО ребёнка — токен, который он открывает, сужен до этого
ребёнка, и записать «не тому» сервер не даст даже при ошибке здесь.

Раскладка в Redis:

- `bot:bindings:<chat>` — хеш «patient_id → привязка в JSON»;
- `bot:active:<chat>` — patient_id выбранного ребёнка;
- `bot:binding:<chat>` — прежний хеш одной привязки (до ADR-0048). Читается и
  переносится в новую раскладку при первом обращении, чтобы обновление бота не
  отвязало ни одной семьи.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any, cast

from redis.asyncio import Redis

_LEGACY_PREFIX = "bot:binding:"
_BINDINGS_PREFIX = "bot:bindings:"
_ACTIVE_PREFIX = "bot:active:"


@dataclass(frozen=True, slots=True)
class Binding:
    link_id: uuid.UUID
    secret: str
    patient_id: uuid.UUID
    patient_name: str
    #: Имя без фамилии — им бот называет ребёнка, когда чат ведёт двоих. У
    #: записей, заведённых до ADR-0048, его нет, и оно выводится из полного
    #: имени по тому же правилу, что на сервере («Имя и фамилия»).
    patient_first_name: str = ""

    @property
    def first_name(self) -> str:
        if self.patient_first_name:
            return self.patient_first_name
        parts = self.patient_name.split()
        return parts[0] if parts else self.patient_name


def _to_json(binding: Binding) -> str:
    return json.dumps(
        {
            "link_id": str(binding.link_id),
            "secret": binding.secret,
            "patient_id": str(binding.patient_id),
            "patient_name": binding.patient_name,
            "patient_first_name": binding.patient_first_name,
        },
        ensure_ascii=False,
    )


def _from_mapping(raw: dict[str, Any]) -> Binding:
    return Binding(
        link_id=uuid.UUID(str(raw["link_id"])),
        secret=str(raw["secret"]),
        patient_id=uuid.UUID(str(raw["patient_id"])),
        patient_name=str(raw["patient_name"]),
        patient_first_name=str(raw.get("patient_first_name") or ""),
    )


class BindingStore:
    """Привязки чата — по одной на ребёнка — и выбранный ребёнок.

    Без срока жизни: привязка живёт до отзыва.

    `cast` повсюду из-за типов redis-py: методы объявлены общими для sync и
    async клиентов и возвращают `Awaitable[T] | T`. У асинхронного клиента это
    всегда первое, но статически это не выражено.
    """

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def all(self, chat_id: int) -> list[Binding]:
        """Все дети чата в постоянном порядке — по имени, затем по идентификатору."""

        await self._migrate_legacy(chat_id)
        raw: dict[Any, Any] = await cast(
            "Awaitable[dict[Any, Any]]", self._redis.hgetall(_BINDINGS_PREFIX + str(chat_id))
        )
        bindings: list[Binding] = []
        broken: list[Any] = []
        for field_name, value in raw.items():
            try:
                bindings.append(_from_mapping(json.loads(_text(value))))
            except (KeyError, ValueError, TypeError):
                # Битая запись (частичная запись, смена формата) ведёт себя как
                # отсутствие привязки: семья пройдёт `/start <код>` заново.
                # Молча падать на каждом сообщении хуже.
                broken.append(field_name)
        if broken:
            await cast("Awaitable[int]", self._redis.hdel(_BINDINGS_PREFIX + str(chat_id), *broken))
        return sorted(bindings, key=lambda b: (b.first_name.casefold(), str(b.patient_id)))

    async def get(self, chat_id: int) -> Binding | None:
        """Привязка выбранного ребёнка; если выбор потерян — первого по порядку."""

        bindings = await self.all(chat_id)
        if not bindings:
            return None
        active = await cast("Awaitable[Any]", self._redis.get(_ACTIVE_PREFIX + str(chat_id)))
        for binding in bindings:
            if active is not None and str(binding.patient_id) == _text(active):
                return binding
        return bindings[0]

    async def put(self, chat_id: int, binding: Binding) -> None:
        """Добавляет (или заменяет) привязку ребёнка и делает его выбранным.

        Выбранным — потому что код только что прислан ради этого ребёнка:
        следующую запись семья ведёт про него.
        """

        await self._migrate_legacy(chat_id)
        await cast(
            "Awaitable[int]",
            self._redis.hset(
                _BINDINGS_PREFIX + str(chat_id), str(binding.patient_id), _to_json(binding)
            ),
        )
        await self.select(chat_id, binding.patient_id)

    async def select(self, chat_id: int, patient_id: uuid.UUID) -> Binding | None:
        """Выбирает ребёнка. Ребёнок не из этого чата — None, выбор не меняется."""

        for binding in await self.all(chat_id):
            if binding.patient_id == patient_id:
                await cast(
                    "Awaitable[Any]",
                    self._redis.set(_ACTIVE_PREFIX + str(chat_id), str(patient_id)),
                )
                return binding
        return None

    async def forget(self, chat_id: int, patient_id: uuid.UUID) -> Binding | None:
        """Забывает привязку одного ребёнка (её отозвали) и называет, кто выбран теперь.

        Остальные дети чата остаются: отзыв одной привязки не гасит другую
        (ADR-0048). Возвращает привязку, ставшую выбранной, или None, если
        детей у чата больше нет.
        """

        await self._migrate_legacy(chat_id)
        await cast(
            "Awaitable[int]",
            self._redis.hdel(_BINDINGS_PREFIX + str(chat_id), str(patient_id)),
        )
        remaining = await self.all(chat_id)
        if not remaining:
            await cast("Awaitable[int]", self._redis.delete(_ACTIVE_PREFIX + str(chat_id)))
            return None
        current = await self.get(chat_id)
        if current is not None:
            await self.select(chat_id, current.patient_id)
        return current

    async def _migrate_legacy(self, chat_id: int) -> None:
        """Переносит привязку из раскладки до ADR-0048, если она там осталась."""

        legacy_key = _LEGACY_PREFIX + str(chat_id)
        raw: dict[Any, Any] = await cast(
            "Awaitable[dict[Any, Any]]", self._redis.hgetall(legacy_key)
        )
        if not raw:
            return
        try:
            binding = _from_mapping({_text(k): _text(v) for k, v in raw.items()})
        except (KeyError, ValueError, TypeError):
            await cast("Awaitable[int]", self._redis.delete(legacy_key))
            return
        await cast(
            "Awaitable[int]",
            self._redis.hset(
                _BINDINGS_PREFIX + str(chat_id), str(binding.patient_id), _to_json(binding)
            ),
        )
        await cast(
            "Awaitable[Any]",
            self._redis.set(_ACTIVE_PREFIX + str(chat_id), str(binding.patient_id), nx=True),
        )
        await cast("Awaitable[int]", self._redis.delete(legacy_key))


def _text(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)
