"""Сборка сводки для главного экрана (раздел 5.3 ТЗ, раздел 8.3 ТЗ).

Расчётов здесь нет: итоги дня берутся из сохранённого меню, а соответствие
допускам считает `keto_engine.within_tolerance` — допуски живут только в ядре
(правило 2 CLAUDE.md). Доступ к БД — через репозитории `core`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models import KetoneLog, Menu, Prescription, WeightLog
from core.repositories import menus as menus_repo
from core.repositories import overview as overview_repo
from core.repositories import prescriptions as prescriptions_repo
from keto_engine import DishResult, Targets, within_tolerance

from ..schemas import DishComputed, PrescriptionRead
from ..schemas_overview import (
    DaySummary,
    DayTolerance,
    KetoneReading,
    PatientOverview,
    SeizuresToday,
    WeightReading,
)


def local_today() -> date:
    """Сегодняшняя дата в часовом поясе установки (`settings.tz`), а не в UTC.

    В UTC+5 после 19:00 местных суток UTC-дата уже другая: по UTC-дате семья
    поздним вечером увидела бы пустой «завтрашний» день вместо своих итогов.
    """

    return datetime.now(ZoneInfo(get_settings().tz)).date()


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    """Границы местных суток как моменты времени — для сравнения с `occurred_at`."""

    tz = ZoneInfo(get_settings().tz)
    start = datetime.combine(day, time.min, tzinfo=tz)
    # Конец суток — полночь следующей ДАТЫ, а не «старт + 24 часа»: при переводе
    # часов сутки короче или длиннее 24 часов.
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start, end


def _day_summary(menu: Menu | None, prescription: Prescription | None) -> DaySummary | None:
    """Итоги дня и их соответствие назначению.

    Меню на сегодня может не быть — тогда итогов нет, и это не ошибка (семья ещё
    не составила день). То же и у меню без сохранённых итогов: показывать вместо
    них нули нельзя, ноль калорий — это утверждение, что ребёнок не ел.
    """

    if menu is None or menu.totals is None:
        return None

    totals = DishComputed.model_validate(menu.totals)
    return DaySummary(
        totals=totals,
        tolerance=_tolerance(totals, prescription),
        engine_version=menu.engine_version,
    )


def _tolerance(totals: DishComputed, prescription: Prescription | None) -> DayTolerance | None:
    if prescription is None:
        return None

    # DishResult собирается из сохранённых итогов только ради вызова
    # `within_tolerance`: сам состав дня (items) в допусках не участвует.
    dish = DishResult(
        items=(),
        kcal=totals.kcal,
        fat_g=totals.fat,
        protein_g=totals.protein,
        carbs_g=totals.carbs,
        fiber_g=totals.fiber,
        ratio=totals.ratio,
    )
    targets = Targets(ratio=float(prescription.ratio), kcal=float(prescription.kcal_per_day))
    ratio_ok, kcal_ok = within_tolerance(dish, targets)
    return DayTolerance(ratio_within_tolerance=ratio_ok, kcal_within_tolerance=kcal_ok)


async def build_overview(session: AsyncSession, *, patient_id: uuid.UUID) -> PatientOverview:
    today = local_today()
    day_start, day_end = _day_bounds(today)

    prescription = await prescriptions_repo.get_active(session, patient_id=patient_id)
    menu = await menus_repo.get_by_date(session, patient_id=patient_id, menu_date=today)
    ketone = await overview_repo.latest_log(session, KetoneLog, patient_id=patient_id)
    weight = await overview_repo.latest_log(session, WeightLog, patient_id=patient_id)
    seizures = await overview_repo.count_seizures(
        session, patient_id=patient_id, period_from=day_start, period_to=day_end
    )

    return PatientOverview(
        patient_id=patient_id,
        date=today,
        prescription=PrescriptionRead.model_validate(prescription) if prescription else None,
        day=_day_summary(menu, prescription),
        last_ketone=KetoneReading.model_validate(ketone) if ketone else None,
        last_weight=WeightReading.model_validate(weight) if weight else None,
        seizures_today=SeizuresToday.model_validate(seizures),
    )
