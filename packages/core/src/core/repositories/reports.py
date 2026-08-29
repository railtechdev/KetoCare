"""Выборки за период для отчёта по пациенту (раздел 5.3 ТЗ, `/reports`).

Отдельный модуль, а не дополнение к `diary` и `menus`: отчёту нужны запросы
другой формы — весь период целиком, без пагинации и без счётчиков, зато со
связанными справочниками. Так же обособлен `overview`.

Границы периода приходят уже вычисленными: правило «сутки считает сервер по
своей зоне» живёт в слое API, и повторять его здесь значило бы получить два
ответа на вопрос, когда начинается день.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    DoctorSummary,
    KetoneLog,
    Menu,
    MenuItem,
    SeizureLog,
    SeizureType,
    SideEffectLog,
    WeightLog,
)


@dataclass(frozen=True, slots=True)
class SeizureRow:
    """Приступ вместе с названием и кодом типа: отчёт печатает названия, а не id."""

    occurred_at: datetime
    seizure_type_id: uuid.UUID
    name_ru: str
    code: str | None
    count: int


async def list_seizures(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> list[SeizureRow]:
    stmt = (
        select(
            SeizureLog.occurred_at,
            SeizureLog.seizure_type_id,
            SeizureType.name_ru,
            SeizureType.code,
            # Псевдоним обязателен: у строки результата уже есть метод `count`
            # (она кортеж), и обращение к `row.count` вернуло бы метод, а не
            # число приступов — mypy это поймал, а тест бы, возможно, нет.
            SeizureLog.count.label("seizure_count"),
        )
        .join(SeizureType, SeizureType.id == SeizureLog.seizure_type_id)
        .where(
            SeizureLog.patient_id == patient_id,
            SeizureLog.deleted_at.is_(None),
            SeizureLog.occurred_at >= period_from,
            SeizureLog.occurred_at <= period_to,
        )
        .order_by(SeizureLog.occurred_at)
    )
    rows = await session.execute(stmt)
    return [
        SeizureRow(
            occurred_at=row.occurred_at,
            seizure_type_id=row.seizure_type_id,
            name_ru=row.name_ru,
            code=row.code,
            count=row.seizure_count,
        )
        for row in rows
    ]


async def list_ketones(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> list[KetoneLog]:
    return list(
        await session.scalars(
            select(KetoneLog)
            .where(
                KetoneLog.patient_id == patient_id,
                KetoneLog.deleted_at.is_(None),
                KetoneLog.occurred_at >= period_from,
                KetoneLog.occurred_at <= period_to,
            )
            .order_by(KetoneLog.occurred_at)
        )
    )


async def list_weights(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> list[WeightLog]:
    return list(
        await session.scalars(
            select(WeightLog)
            .where(
                WeightLog.patient_id == patient_id,
                WeightLog.deleted_at.is_(None),
                WeightLog.occurred_at >= period_from,
                WeightLog.occurred_at <= period_to,
            )
            .order_by(WeightLog.occurred_at)
        )
    )


async def list_side_effects(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> list[SideEffectLog]:
    return list(
        await session.scalars(
            select(SideEffectLog)
            .where(
                SideEffectLog.patient_id == patient_id,
                SideEffectLog.deleted_at.is_(None),
                SideEffectLog.occurred_at >= period_from,
                SideEffectLog.occurred_at <= period_to,
            )
            .order_by(SideEffectLog.occurred_at)
        )
    )


@dataclass(frozen=True, slots=True)
class MenuAdherenceRow:
    days_planned: int
    items_planned: int
    items_eaten: int


async def menu_adherence(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: date,
    period_to: date,
) -> MenuAdherenceRow:
    """Сколько дней было спланировано и сколько позиций отмечено съеденными.

    Считается по позициям, а не по дням: день, где съеден завтрак и пропущен
    ужин, не «выполнен» и не «пропущен» — отчёт показывает долю.
    """

    stmt = (
        select(Menu.date, MenuItem.eaten)
        .join(MenuItem, MenuItem.menu_id == Menu.id)
        .where(
            Menu.patient_id == patient_id,
            Menu.deleted_at.is_(None),
            MenuItem.deleted_at.is_(None),
            Menu.date >= period_from,
            Menu.date <= period_to,
        )
    )
    rows = list(await session.execute(stmt))

    return MenuAdherenceRow(
        days_planned=len({row.date for row in rows}),
        items_planned=len(rows),
        items_eaten=sum(1 for row in rows if row.eaten),
    )


async def list_approved_summaries(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: date,
    period_to: date,
) -> list[DoctorSummary]:
    """Только подтверждённые врачом сводки.

    Черновик (`draft_md`) в отчёт не попадает никогда: результат Claude
    становится клиническими данными лишь после подтверждения человеком
    (правило 6 CLAUDE.md). Фильтр стоит здесь, в единственном месте выборки, —
    в схеме ответа его легко было бы забыть.
    """

    return list(
        await session.scalars(
            select(DoctorSummary)
            .where(
                DoctorSummary.patient_id == patient_id,
                DoctorSummary.approved_md.is_not(None),
                DoctorSummary.period_end >= period_from,
                DoctorSummary.period_start <= period_to,
            )
            .order_by(DoctorSummary.period_start)
        )
    )
