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
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    DoctorSummary,
    KetoneLog,
    MealLog,
    Medication,
    MedicationLog,
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

    rows = await session.scalars(
        select(DoctorSummary)
        .where(
            DoctorSummary.patient_id == patient_id,
            DoctorSummary.approved_md.is_not(None),
            DoctorSummary.period_end >= period_from,
            DoctorSummary.period_start <= period_to,
        )
        # За один период сводку можно утвердить дважды — черновик собирается
        # заново, если первый не понравился. В отчёт идёт последняя: два разных
        # описания одних данных врач читает как противоречие, а понять, какое
        # действующее, по документу нельзя. Удалять прежнюю нечем и незачем
        # (правило 4), поэтому выбор делается здесь.
        .order_by(DoctorSummary.period_start, DoctorSummary.approved_at)
    )

    latest: dict[tuple[date, date], DoctorSummary] = {}
    for row in rows:
        latest[(row.period_start, row.period_end)] = row
    return [latest[key] for key in sorted(latest)]


@dataclass(frozen=True, slots=True)
class MedicationAdherenceRow:
    """Отметки о приёме одного препарата за период.

    Только измеримое: сколько отметок и сколько из них «не принято». Доли
    «пропущено из положенных» здесь нет и быть не может — `medications.frequency`
    свободная строка, из которой число приёмов в сутки не выводится (вопрос 37
    в docs/medical/OPEN_QUESTIONS.md).
    """

    medication_id: uuid.UUID
    drug_name: str
    dose: str
    entries: int
    taken: int


async def medication_adherence(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> list[MedicationAdherenceRow]:
    """Отметки о приёме препаратов, сгруппированные по препарату."""

    stmt = (
        select(
            Medication.id,
            Medication.drug_name,
            Medication.dose,
            func.count(MedicationLog.id),
            func.count(MedicationLog.id).filter(MedicationLog.taken.is_(True)),
        )
        .join(MedicationLog, MedicationLog.medication_id == Medication.id)
        .where(
            MedicationLog.patient_id == patient_id,
            MedicationLog.deleted_at.is_(None),
            MedicationLog.occurred_at >= period_from,
            MedicationLog.occurred_at <= period_to,
        )
        .group_by(Medication.id, Medication.drug_name, Medication.dose)
        .order_by(Medication.drug_name)
    )
    return [
        MedicationAdherenceRow(
            medication_id=row[0], drug_name=row[1], dose=row[2], entries=row[3], taken=row[4]
        )
        for row in await session.execute(stmt)
    ]


#: Дневниковые таблицы, запись в любую из которых считается «семья вела дневник
#: в этот день». Меню сюда не входит: его составляет специалист или родитель
#: заранее, и наличие плана ничего не говорит о том, вели ли записи.
_DIARY_TABLES = (SeizureLog, KetoneLog, WeightLog, MedicationLog, MealLog, SideEffectLog)


async def days_with_entries(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> list[date]:
    """Даты, в которые есть хоть одна дневниковая запись, по возрастанию.

    Раздел 10.5 ТЗ просит «% дней с записями», и это не `days_planned` из
    `menu_adherence`: там считаются дни с составленным МЕНЮ. День с планом и без
    единой отметки — ровно тот случай, о котором сводка должна сказать.
    """

    days: set[date] = set()
    for model in _DIARY_TABLES:
        rows = await session.scalars(
            select(func.date(model.occurred_at))
            .where(
                model.patient_id == patient_id,
                model.deleted_at.is_(None),
                model.occurred_at >= period_from,
                model.occurred_at <= period_to,
            )
            .distinct()
        )
        days.update(rows)
    return sorted(days)


@dataclass(frozen=True, slots=True)
class MenuDayRow:
    """Итоги спланированного дня — то, что уже посчитано ядром при сохранении меню."""

    date: date
    totals: dict[str, Any]
    engine_version: str | None


async def list_menu_days(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: date,
    period_to: date,
) -> list[MenuDayRow]:
    """Дни с посчитанными итогами меню за период.

    Итоги берутся сохранёнными, а не пересчитываются: день считался тем ядром,
    что было на момент сохранения, и `engine_version` идёт вместе с числами.
    """

    rows = await session.execute(
        select(Menu.date, Menu.totals, Menu.engine_version)
        .where(
            Menu.patient_id == patient_id,
            Menu.deleted_at.is_(None),
            Menu.totals.is_not(None),
            Menu.date >= period_from,
            Menu.date <= period_to,
        )
        .order_by(Menu.date)
    )
    return [
        MenuDayRow(date=row[0], totals=row[1], engine_version=row[2])
        for row in rows
        if row[1] is not None
    ]
