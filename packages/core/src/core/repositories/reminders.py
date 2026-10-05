"""Настройки напоминаний и след об отправке (раздел 7.4 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ReminderDelivery, ReminderSettings, TelegramAccount
from . import therapy as therapy_repo

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


def default_settings(patient_id: uuid.UUID) -> ReminderSettings:
    """Настройки, которые действуют, пока семья их не меняла.

    Единственное включённое из коробки — мягкое «за сегодня нет записей» в
    20:00 (раздел 7.4 ТЗ). Строка в базе не заводится: она заводится при первой
    правке, иначе однажды разошлась бы с умолчанием при его смене.
    """

    return ReminderSettings(
        patient_id=patient_id,
        enabled=True,
        ketones_at=None,
        weight_at=None,
        medications_at=None,
        no_records_at=time(hour=DEFAULT_NO_RECORDS_HOUR),
    )


async def list_active(session: AsyncSession) -> list[tuple[ReminderSettings, TelegramAccount]]:
    """Кому вообще есть куда напоминать: каждый живой чат и настройки его ребёнка.

    Выборка идёт от привязок, а не от настроек: прежде она соединяла их
    внутренним соединением, и семья, ни разу не открывавшая настройки — то есть
    каждая семья из Telegram, у которой кабинета нет, — не получала даже
    напоминания «из коробки» (аудит блокеров, 05.10.2026). Умолчание
    существовало только в ответе экрану.
    """

    stmt = (
        select(TelegramAccount, ReminderSettings)
        .outerjoin(ReminderSettings, ReminderSettings.patient_id == TelegramAccount.patient_id)
        .where(
            TelegramAccount.revoked_at.is_(None),
            # Терапия завершена — напоминать о замерах больше не о чем
            # (вопрос 18, ADR-0050). Привязка чата при этом остаётся.
            ~therapy_repo.therapy_ended(TelegramAccount.patient_id),
        )
    )
    rows = await session.execute(stmt)
    result: list[tuple[ReminderSettings, TelegramAccount]] = []
    for link, settings in rows:
        effective = settings if settings is not None else default_settings(link.patient_id)
        if effective.enabled:
            result.append((effective, link))
    return result


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
        .on_conflict_do_nothing(index_elements=["patient_id", "kind", "sent_on", "chat_id"])
        .returning(ReminderDelivery.id)
    )
    return await session.scalar(stmt) is not None
