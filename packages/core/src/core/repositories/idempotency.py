"""Репозиторий ключей повторной отправки (ADR-0035)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdempotencyKey

#: Сколько живёт ключ. Сутки — с запасом на «вернулся к экрану вечером и нажал
#: ещё раз»; дольше ответ хранить незачем, а в нём данные ребёнка.
KEY_TTL = timedelta(hours=24)


async def reserve(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    key: str,
    request_hash: str,
    patient_id: uuid.UUID | None,
    now: datetime,
) -> uuid.UUID | None:
    """Занимает ключ под запрос. `None` — ключ уже занят (см. `get`).

    Бронь идёт в той же транзакции, что и сама запись: если запись не удалась,
    откат снимает и бронь. Одновременный повтор ждёт на уникальном ограничении,
    пока первый запрос не закончится, и затем видит его готовый ответ.
    Просроченная бронь сначала освобождается.
    """

    await session.execute(
        delete(IdempotencyKey).where(
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.key == key,
            IdempotencyKey.created_at < now - KEY_TTL,
        )
    )
    reserved: uuid.UUID | None = await session.scalar(
        insert(IdempotencyKey)
        .values(
            user_id=user_id,
            key=key,
            request_hash=request_hash,
            patient_id=patient_id,
        )
        .on_conflict_do_nothing(constraint="uq_idempotency_keys_user_key")
        .returning(IdempotencyKey.id)
    )
    return reserved


async def get(session: AsyncSession, *, user_id: uuid.UUID, key: str) -> IdempotencyKey | None:
    found: IdempotencyKey | None = await session.scalar(
        select(IdempotencyKey).where(IdempotencyKey.user_id == user_id, IdempotencyKey.key == key)
    )
    return found


async def complete(
    session: AsyncSession, *, key_id: uuid.UUID, status: int, body: dict[str, Any]
) -> None:
    await session.execute(
        update(IdempotencyKey)
        .where(IdempotencyKey.id == key_id)
        .values(response_status=status, response_body=body)
    )


async def release(session: AsyncSession, *, key_id: uuid.UUID) -> None:
    """Снять бронь: запрос не состоялся, и ключ должен снова стать свободным.

    Нужна там, где ответ уже закоммичен, а довести дело не удалось: оставленная
    бронь отвечала бы повтору прежним ответом, хотя работы за ним нет.
    """

    await session.execute(delete(IdempotencyKey).where(IdempotencyKey.id == key_id))


async def purge_expired(session: AsyncSession, *, now: datetime) -> int:
    """Снимает ключи старше `KEY_TTL`. Возвращает число снятых строк."""

    result = await session.execute(
        delete(IdempotencyKey).where(IdempotencyKey.created_at < now - KEY_TTL)
    )
    return int(getattr(result, "rowcount", 0) or 0)
