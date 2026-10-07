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


@dataclass(frozen=True, slots=True)
class _Scored:
    """Измерение с посчитанными z-баллами — общий ряд для раздела карты и пометки.

    z хранятся несокращёнными: округление и перцентиль делает `_score`, ровно
    как раньше делал его на каждой точке.
    """

    measurement: Measurement
    age_days: int
    bmi: float | None
    wfa: float | None
    hfa: float | None
    bmi_for_age: float | None


#: Сколько последних взвешиваний оценивать. Взвешивание раз в неделю — это
#: десять лет наблюдения; длиннее ряд экран не покажет.
GROWTH_POINTS_LIMIT = 500


@dataclass(frozen=True, slots=True)
class _Child:
    sex: who.SexCode
    birth_date: date
    therapy_started_on: date | None
    measurements: list[Measurement]


async def _load(session: AsyncSession, patient_id: uuid.UUID) -> _Child | None:
    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        return None
    logs = await diary_repo.weight_series(session, patient_id=patient_id, limit=GROWTH_POINTS_LIMIT)
    tz = ZoneInfo(get_settings().tz)
    return _Child(
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


async def assess_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> GrowthRead | None:
    """Оценка ребёнка по нормам ВОЗ из его дневника веса; `None` — пациента нет.

    Одна дорога для раздела «Рост и вес» карты и для пометки в списке
    пациентов (`significant_drop_for_patient`): пометка, посчитанная иначе, чем
    раздел, на который она ведёт, однажды разошлась бы с ним. Общие у них
    загрузка (`_load`), ряд z-баллов (`_score_series`) и выбор исходного и
    последнего значения (`_indicators`); раздел дополнительно собирает точки
    графика.
    """

    child = await _load(session, patient_id)
    if child is None:
        return None
    return assess(
        sex=child.sex,
        birth_date=child.birth_date,
        therapy_started_on=child.therapy_started_on,
        measurements=child.measurements,
    )


async def significant_drop_for_patient(
    session: AsyncSession, *, patient_id: uuid.UUID
) -> bool | None:
    """Пометка списка пациентов: снизился ли хоть один показатель на ≥ 1,0 SD.

    Тот же ответ, что `indicators[*].significant_drop` у `assess_patient`, но
    без точек графика: пометку считает КАЖДАЯ сводка специалиста (главная врача
    — `1 + N` сводок), и на годовом ряду ежедневных взвешиваний сборка сотен
    точек стоила дороже, чем сам счёт (замер 07.10.2026, infra/load/README.md,
    «Веер сводок»). `None` — пациента нет.
    """

    child = await _load(session, patient_id)
    if child is None:
        return None
    series = _score_series(child.sex, child.birth_date, child.measurements)
    return any(
        indicator.significant_drop for indicator in _indicators(series, child.therapy_started_on)
    )


def _score_of(z: float) -> GrowthScore:
    return GrowthScore(z=round(z, 2), percentile=round(who.percentile(z), 1))


def _score(z: float | None) -> GrowthScore | None:
    return None if z is None else _score_of(z)


def _score_series(
    sex: who.SexCode, birth_date: date, measurements: Sequence[Measurement]
) -> list[_Scored]:
    series: list[_Scored] = []
    for item in sorted(measurements, key=lambda m: m.measured_on):
        age_days = (item.measured_on - birth_date).days
        bmi_value = who.bmi(item.weight_kg, item.height_cm) if item.height_cm else None
        series.append(
            _Scored(
                measurement=item,
                age_days=age_days,
                bmi=bmi_value,
                wfa=who.zscore("wfa", sex, age_days, item.weight_kg),
                hfa=who.zscore("hfa", sex, age_days, item.height_cm) if item.height_cm else None,
                bmi_for_age=who.zscore("bmi", sex, age_days, bmi_value) if bmi_value else None,
            )
        )
    return series


def assess(
    *,
    sex: who.SexCode,
    birth_date: date,
    therapy_started_on: date | None,
    measurements: Sequence[Measurement],
) -> GrowthRead:
    series = _score_series(sex, birth_date, measurements)
    points = [
        GrowthPointRead(
            measured_on=item.measurement.measured_on,
            age_days=item.age_days,
            weight_kg=item.measurement.weight_kg,
            height_cm=item.measurement.height_cm,
            bmi=round(item.bmi, 1) if item.bmi is not None else None,
            wfa=_score(item.wfa),
            hfa=_score(item.hfa),
            bmi_for_age=_score(item.bmi_for_age),
        )
        for item in series
    ]
    return GrowthRead(
        points=points,
        indicators=_indicators(series, therapy_started_on),
        significant_drop_sd=who.SIGNIFICANT_DROP_SD,
        source="; ".join((who.SOURCE["standard"], who.SOURCE["reference"])),
    )


def _pick(item: _Scored, indicator: Indicator) -> float | None:
    if indicator == "wfa":
        return item.wfa
    if indicator == "hfa":
        return item.hfa
    return item.bmi_for_age


def _indicators(series: Sequence[_Scored], start: date | None) -> list[GrowthIndicatorRead]:
    return [_indicator(name, series, start) for name in INDICATORS]


def _indicator(
    indicator: Indicator, series: Sequence[_Scored], start: date | None
) -> GrowthIndicatorRead:
    scored = [
        (item.measurement.measured_on, z)
        for item in series
        if (z := _pick(item, indicator)) is not None
    ]
    if not scored:
        return GrowthIndicatorRead(indicator=indicator)

    baseline_on, baseline_z = scored[0]
    if start is not None:
        before = [(on, z) for on, z in scored if on <= start]
        after = [(on, z) for on, z in scored if on > start]
        baseline_on, baseline_z = before[-1] if before else after[0]

    latest_on, latest_z = scored[-1]
    baseline, latest = _score_of(baseline_z), _score_of(latest_z)
    comparable = latest_on > baseline_on
    return GrowthIndicatorRead(
        indicator=indicator,
        baseline_on=baseline_on,
        baseline=baseline,
        latest_on=latest_on,
        latest=latest,
        change_sd=round(latest.z - baseline.z, 2) if comparable else None,
        significant_drop=comparable and who.significant_drop(baseline.z, latest.z),
    )
