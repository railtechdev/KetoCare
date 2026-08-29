"""Репозиторий дневниковых записей (раздел 4.2 ТЗ, «Питание и дневники»).

Шесть таблиц логов различаются только специфичными полями, а общая часть
(`patient_id`, `occurred_at`, `source`, `created_by`, `deleted_at`) описана одним
миксином `DiaryLogMixin`. Поэтому выборка, создание, изменение и мягкое удаление
параметризованы моделью: шесть копий одних и тех же запросов расходились бы при
первой же правке.

Мягкое удаление: дневниковые записи физически не удаляются (правило 4 CLAUDE.md),
выборки отсекают `deleted_at is not null`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    KetoneLog,
    MealLog,
    Medication,
    MedicationLog,
    MenuItem,
    SeizureLog,
    SeizureType,
    SideEffectLog,
    WeightLog,
)
from ..models.enums import DiarySource

DiaryLog = SeizureLog | KetoneLog | WeightLog | MedicationLog | MealLog | SideEffectLog


async def get[M: DiaryLog](session: AsyncSession, model: type[M], log_id: uuid.UUID) -> M | None:
    """Запись дневника, если она не удалена мягко."""

    log: M | None = await session.scalar(
        select(model).where(model.id == log_id, model.deleted_at.is_(None))
    )
    return log


async def list_for_patient[M: DiaryLog](
    session: AsyncSession,
    model: type[M],
    *,
    patient_id: uuid.UUID,
    period_from: datetime | None = None,
    period_to: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[M], int]:
    """Записи пациента за период, новые сверху."""

    conditions: list[ColumnElement[bool]] = [
        model.patient_id == patient_id,
        model.deleted_at.is_(None),
    ]
    if period_from is not None:
        conditions.append(model.occurred_at >= period_from)
    if period_to is not None:
        conditions.append(model.occurred_at <= period_to)

    stmt = (
        select(model)
        .where(*conditions)
        # Вторичная сортировка по id обязательна: за одну минуту семья вносит
        # несколько записей с одинаковым occurred_at, и без устойчивого порядка
        # соседние страницы выдачи повторяли бы одни записи и теряли другие.
        .order_by(model.occurred_at.desc(), model.id)
        .limit(limit)
        .offset(offset)
    )
    items: list[M] = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(model).where(*conditions))
    return items, int(total or 0)


async def create[M: DiaryLog](
    session: AsyncSession,
    model: type[M],
    *,
    patient_id: uuid.UUID,
    occurred_at: datetime,
    source: DiarySource,
    created_by: uuid.UUID | None,
    fields: dict[str, Any],
) -> M:
    """`fields` — специфичные поля конкретного вида записи; общие передаются явно."""

    log = model(
        patient_id=patient_id,
        occurred_at=occurred_at,
        source=source,
        created_by=created_by,
        **fields,
    )
    session.add(log)
    await session.flush()
    return log


async def update[M: DiaryLog](session: AsyncSession, *, log: M, fields: dict[str, Any]) -> M:
    """Частичное обновление: применяются только переданные поля.

    `patient_id`, `source` и `created_by` сюда не попадают — их проставляет сервер
    при создании, и менять их через API нельзя.
    """

    for key, value in fields.items():
        setattr(log, key, value)
    await session.flush()
    return log


async def soft_delete[M: DiaryLog](session: AsyncSession, *, log: M) -> M:
    log.deleted_at = datetime.now(UTC)
    await session.flush()
    return log


async def seizure_type_exists(session: AsyncSession, seizure_type_id: uuid.UUID) -> bool:
    """Справочник `seizure_types` общий, к пациенту не привязан (раздел 4.2 ТЗ)."""

    found = await session.scalar(select(SeizureType.id).where(SeizureType.id == seizure_type_id))
    return found is not None


async def medication_belongs_to_patient(
    session: AsyncSession, *, medication_id: uuid.UUID, patient_id: uuid.UUID
) -> bool:
    found = await session.scalar(
        select(Medication.id).where(
            Medication.id == medication_id,
            Medication.patient_id == patient_id,
            Medication.deleted_at.is_(None),
        )
    )
    return found is not None


async def menu_item_belongs_to_patient(
    session: AsyncSession, *, menu_item_id: uuid.UUID, patient_id: uuid.UUID
) -> bool:
    found = await session.scalar(
        select(MenuItem.id).where(
            MenuItem.id == menu_item_id,
            MenuItem.patient_id == patient_id,
            MenuItem.deleted_at.is_(None),
        )
    )
    return found is not None
