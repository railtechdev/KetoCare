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

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from core.growth import who

from ..schemas_growth import GrowthIndicatorRead, GrowthPointRead, GrowthRead, GrowthScore

Indicator = Literal["wfa", "hfa", "bmi"]
INDICATORS: tuple[Indicator, ...] = ("wfa", "hfa", "bmi")


@dataclass(frozen=True, slots=True)
class Measurement:
    measured_on: date
    weight_kg: float
    height_cm: float | None


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
