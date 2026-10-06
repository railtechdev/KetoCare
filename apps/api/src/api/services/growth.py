"""Рост и вес относительно возрастной нормы ВОЗ (вопрос 15, ADR-0050).

Ответ клиники от 09.09.2026: «Считать по ВОЗ, врачу показать оба (перцентиль и
z-балл). Снижение соответствующего z-балла на ≥ 1,0 SD от исходного значения
считать значимым и выводить врачу».

Счёт — `core.growth.who` (таблицы LMS ВОЗ без изменений). Здесь только
сборка ряда и выбор исходного значения.

**Исходное значение** — последнее измерение не позже даты начала терапии; если
до старта измерений нет — первое после него; если дата начала неизвестна —
самое первое. Так «от исходного» означает «от состояния на старте диеты», ради
чего клиника и спрашивает: замедление роста — риск именно терапии.

**Рост не переносится между записями.** ИМТ и рост-к-возрасту считаются только
по записи, где рост измерен вместе с весом: подставить рост полугодовой давности
к сегодняшнему весу значило бы выдумать ИМТ.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.growth import who
from core.models import WeightLog
from core.models.enums import Sex
from core.repositories import diary as diary_repo
from core.repositories import patients as patients_repo
from core.repositories import therapy as therapy_repo

from ..schemas_growth import GrowthIndicatorRead, GrowthPointRead, GrowthRead, GrowthScore

Indicator = Literal["wfa", "hfa", "bmi"]
INDICATORS: tuple[Indicator, ...] = ("wfa", "hfa", "bmi")


@dataclass(frozen=True, slots=True)
class Measurement:
    measured_on: date
    weight_kg: float
    height_cm: float | None


#: Сколько последних взвешиваний оценивать. Взвешивание раз в неделю — это
#: десять лет наблюдения; длиннее ряд экран не покажет.
GROWTH_POINTS_LIMIT = 500


async def assess_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> GrowthRead | None:
    """Оценка ребёнка по нормам ВОЗ из его дневника веса; `None` — пациента нет.

    Одна дорога для раздела «Рост и вес» карты и для пометки в списке
    пациентов: пометка, посчитанная иначе, чем раздел, на который она ведёт,
    однажды разошлась бы с ним.
    """

    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        return None
    logs, _total = await diary_repo.list_for_patient(
        session, WeightLog, patient_id=patient_id, limit=GROWTH_POINTS_LIMIT
    )
    tz = ZoneInfo(get_settings().tz)
    return assess(
        sex="m" if patient.sex is Sex.M else "f",
        birth_date=patient.birth_date,
        therapy_started_on=await therapy_repo.started_on(session, patient_id=patient_id),
        measurements=[
            Measurement(
                measured_on=log.occurred_at.astimezone(tz).date(),
                weight_kg=float(log.weight_kg),
                height_cm=float(log.height_cm) if log.height_cm is not None else None,
            )
            for log in logs
        ],
    )


def has_significant_drop(growth: GrowthRead) -> bool:
    """Хотя бы один показатель снизился от исходного на порог клиники (≥ 1,0 SD)."""

    return any(indicator.significant_drop for indicator in growth.indicators)


def _score(
    indicator: Indicator, sex: who.SexCode, age_days: int, value: float
) -> GrowthScore | None:
    z = who.zscore(indicator, sex, age_days, value)
    if z is None:
        return None
    return GrowthScore(z=round(z, 2), percentile=round(who.percentile(z), 1))


def assess(
    *,
    sex: who.SexCode,
    birth_date: date,
    therapy_started_on: date | None,
    measurements: Sequence[Measurement],
) -> GrowthRead:
    points: list[GrowthPointRead] = []
    for item in sorted(measurements, key=lambda m: m.measured_on):
        age_days = (item.measured_on - birth_date).days
        bmi_value = who.bmi(item.weight_kg, item.height_cm) if item.height_cm else None
        points.append(
            GrowthPointRead(
                measured_on=item.measured_on,
                age_days=age_days,
                weight_kg=item.weight_kg,
                height_cm=item.height_cm,
                bmi=round(bmi_value, 1) if bmi_value is not None else None,
                wfa=_score("wfa", sex, age_days, item.weight_kg),
                hfa=_score("hfa", sex, age_days, item.height_cm) if item.height_cm else None,
                bmi_for_age=_score("bmi", sex, age_days, bmi_value) if bmi_value else None,
            )
        )

    return GrowthRead(
        points=points,
        indicators=[_indicator(name, points, therapy_started_on) for name in INDICATORS],
        significant_drop_sd=who.SIGNIFICANT_DROP_SD,
        source="; ".join((who.SOURCE["standard"], who.SOURCE["reference"])),
    )


def _pick(point: GrowthPointRead, indicator: Indicator) -> GrowthScore | None:
    if indicator == "wfa":
        return point.wfa
    if indicator == "hfa":
        return point.hfa
    return point.bmi_for_age


def _indicator(
    indicator: Indicator, points: Sequence[GrowthPointRead], start: date | None
) -> GrowthIndicatorRead:
    scored = [(p, s) for p in points if (s := _pick(p, indicator)) is not None]
    if not scored:
        return GrowthIndicatorRead(indicator=indicator)

    baseline_point, baseline = scored[0]
    if start is not None:
        before = [(p, s) for p, s in scored if p.measured_on <= start]
        after = [(p, s) for p, s in scored if p.measured_on > start]
        baseline_point, baseline = before[-1] if before else after[0]

    latest_point, latest = scored[-1]
    comparable = latest_point.measured_on > baseline_point.measured_on
    return GrowthIndicatorRead(
        indicator=indicator,
        baseline_on=baseline_point.measured_on,
        baseline=baseline,
        latest_on=latest_point.measured_on,
        latest=latest,
        change_sd=round(latest.z - baseline.z, 2) if comparable else None,
        significant_drop=comparable and who.significant_drop(baseline.z, latest.z),
    )
