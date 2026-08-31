"""Настройки напоминаний и след об отправке (раздел 7.4 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ReminderDelivery, ReminderSettings, TelegramAccount

#: Время «за сегодня нет записей» по умолчанию (раздел 7.4 ТЗ).
#:
#: Оно и есть единственное включённое из коробки: остальные виды напоминаний
#: семья задаёт сама, а мягкое напоминание вечером — то, о чём ТЗ говорит
#: значением по умолчанию.
DEFAULT_NO_RECORDS_HOUR = 20


async def get(session: AsyncSession, *, patient_id: uuid.UUID) -> ReminderSettings | None:
    found: ReminderSettings | None = await session.scalar(
        select(ReminderSettings).where(ReminderSettings.patient_id == patient_id)
    )
    return found


async def upsert(
    session: AsyncSession, *, patient_id: uuid.UUID, updated_by: uuid.UUID | None, **fields: Any
) -> ReminderSettings:
    """Настройки ребёнка: одна строка, создаётся при первой правке."""

    settings = await get(session, patient_id=patient_id)
    if settings is None:
        settings = ReminderSettings(patient_id=patient_id)
        session.add(settings)

    for key, value in fields.items():
        setattr(settings, key, value)
    settings.updated_by = updated_by
    await session.flush()
    return settings


async def list_active(session: AsyncSession) -> list[tuple[ReminderSettings, TelegramAccount]]:
    """Кому вообще есть куда напоминать.

    Настройки без живой привязки Telegram бесполезны: отправлять некуда.
    Поэтому выборка сразу соединяет их с привязкой — иначе воркер перебирал бы
    всех пациентов клиники, чтобы на каждом втором обнаружить, что чата нет.
    """

    stmt = (
        select(ReminderSettings, TelegramAccount)
        .join(TelegramAccount, TelegramAccount.patient_id == ReminderSettings.patient_id)
        .where(
            ReminderSettings.enabled.is_(True),
            TelegramAccount.revoked_at.is_(None),
        )
    )
    rows = await session.execute(stmt)
    return [(row[0], row[1]) for row in rows]


async def claim_delivery(
    session: AsyncSession, *, patient_id: uuid.UUID, kind: str, sent_on: date, chat_id: int
) -> bool:
    """Занимает право отправить напоминание. False — оно уже отправлено.

    Вставка с `ON CONFLICT DO NOTHING`, а не «прочитать и вставить»: воркер
    может идти в нескольких экземплярах, и раздельная проверка допускала бы
    двойную отправку. Право занимается ДО отправки — лучше пропустить
    напоминание при сбое сети, чем прислать его дважды.
    """

    stmt = (
        insert(ReminderDelivery)
        .values(
            patient_id=patient_id,
            kind=kind,
            sent_on=sent_on,
            sent_at=datetime.now(UTC),
            chat_id=chat_id,
        )
        .on_conflict_do_nothing(index_elements=["patient_id", "kind", "sent_on"])
        .returning(ReminderDelivery.id)
    )
    return await session.scalar(stmt) is not None
