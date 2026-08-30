"""Хранилище привязок бота (ADR-0009).

Здесь лежит второй фактор доступа — секрет привязки, выданный API один раз при
`/start <код>`. Восстановить его нельзя: в БД хранится только sha256, и
восстановление по сервисному токену не предусмотрено намеренно — оно вернуло бы
схему к одному фактору.

Отсюда следствие: хранилище обязано переживать перезапуск бота. Память процесса
не годится — после каждого деплоя все семьи оказались бы отвязаны и должны были
бы заново просить код в кабинете.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from redis.asyncio import Redis

_KEY_PREFIX = "bot:binding:"


@dataclass(frozen=True, slots=True)
class Binding:
    link_id: uuid.UUID
    secret: str
    patient_id: uuid.UUID
    patient_name: str


def _key(chat_id: int) -> str:
    return f"{_KEY_PREFIX}{chat_id}"


class BindingStore:
    """Привязки по chat_id. Без срока жизни: привязка живёт до отзыва."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def get(self, chat_id: int) -> Binding | None:
        raw = await self._redis.hgetall(_key(chat_id))
        if not raw:
            return None
        try:
            return Binding(
                link_id=uuid.UUID(raw["link_id"]),
                secret=raw["secret"],
                patient_id=uuid.UUID(raw["patient_id"]),
                patient_name=raw["patient_name"],
            )
        except (KeyError, ValueError):
            # Битая запись (частичная запись, смена формата) ведёт себя как
            # отсутствие привязки: семья пройдёт `/start <код>` заново. Молча
            # падать на каждом сообщении хуже.
            await self.delete(chat_id)
            return None

    async def put(self, chat_id: int, binding: Binding) -> None:
        await self._redis.hset(
            _key(chat_id),
            mapping={
                "link_id": str(binding.link_id),
                "secret": binding.secret,
                "patient_id": str(binding.patient_id),
                "patient_name": binding.patient_name,
            },
        )

    async def delete(self, chat_id: int) -> None:
        await self._redis.delete(_key(chat_id))
