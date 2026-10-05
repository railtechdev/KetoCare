"""Z-баллы роста и веса ребёнка по таблицам ВОЗ (вопрос 15 медицинской команде).

Ответ клиники 09.09.2026: считать по ВОЗ, врачу показывать и перцентиль, и
z-балл, снижение z-балла на 1,0 SD и больше от исходного считать значимым.

Таблицы — официальные LMS-параметры ВОЗ, перенесённые без изменений (источник,
адреса и контрольные суммы — `data/README.txt`):

- **WHO Child Growth Standards (2006)**, 0-5 лет, таблицы по дням (0..1856);
- **WHO Growth Reference 5-19 years (2007)**, таблицы по месяцам (61..228;
  вес к возрасту ВОЗ публикует только до 120 месяцев).

Метод — LMS (Cole, 1990), как в ВОЗ: ``z = ((X/M)^L − 1) / (L·S)``. Для веса и
ИМТ за пределами ±3 SD — «ограниченный» расчёт ВОЗ (WHO 2006, Methods and
development, ch. 7; computation.pdf к справочнику 2007): за третьим SD шкала
продолжается линейно с шагом, равным расстоянию между 2 и 3 SD, потому что
LMS-кривая там опирается на слишком мало наблюдений. Для роста L = 1, и
ограничение не нужно.

Модуль чистый: на входе возраст в днях и измерение, на выходе число. Как
получено измерение, он не знает: для 0-2 лет таблица ВОЗ описывает длину
лёжа, после 2 лет — рост стоя; поправку 0,7 см за способ измерения модуль НЕ
вносит — измерение берётся таким, каким его записали.
"""

from __future__ import annotations

import csv
import math
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Literal

Indicator = Literal["wfa", "hfa", "bmi"]
SexCode = Literal["m", "f"]

#: Значимое снижение z-балла от исходного — ответ клиники на вопрос 15
#: (09.09.2026): «снижение соответствующего z-балла на ≥ 1,0 SD от исходного
#: значения считать значимым и выводить врачу».
SIGNIFICANT_DROP_SD = 1.0

#: Последний день таблиц стандарта 2006 года (60 месяцев + 30 дней);
#: со следующего дня действует справочник 2007 года.
LAST_STANDARD_DAY = 1856
#: Средняя длина месяца, которой ВОЗ переводит дни в месяцы (365,25 / 12).
DAYS_PER_MONTH = 30.4375

SOURCE: Mapping[str, str] = {
    "standard": "WHO Child Growth Standards (2006), expanded tables by day, 0-1856 days",
    "reference": "WHO Growth Reference 5-19 years (2007), tables by month, 61-228 months",
    "method": "LMS; restricted computation beyond ±3 SD for weight-for-age and BMI-for-age",
    "data": "core/growth/data/README.txt",
}

#: Верхняя граница справочника 2007 года в месяцах по каждому показателю.
_MAX_MONTH: Mapping[Indicator, int] = {"wfa": 120, "hfa": 228, "bmi": 228}
#: Показатели, к которым ВОЗ применяет ограниченный расчёт за ±3 SD.
_RESTRICTED: frozenset[Indicator] = frozenset({"wfa", "bmi"})


@dataclass(frozen=True, slots=True)
class Lms:
    l: float  # noqa: E741 — имя параметра метода LMS
    m: float
    s: float


@cache
def _table(
    indicator: Indicator, period: Literal["2006_day", "2007_month"]
) -> dict[str, dict[int, Lms]]:
    name = f"{indicator}_{period}.csv"
    text = resources.files("core.growth").joinpath("data", name).read_text(encoding="utf-8")
    table: dict[str, dict[int, Lms]] = {"m": {}, "f": {}}
    for row in csv.DictReader(text.splitlines()):
        table[row["sex"]][int(row["age"])] = Lms(float(row["L"]), float(row["M"]), float(row["S"]))
    return table


def lms_at(indicator: Indicator, sex: SexCode, age_days: int) -> Lms | None:
    """LMS-параметры на возраст в днях; ``None`` — возраст вне таблиц ВОЗ."""

    if age_days < 0:
        return None
    if age_days <= LAST_STANDARD_DAY:
        return _table(indicator, "2006_day")[sex].get(age_days)
    months = _table(indicator, "2007_month")[sex]
    age_months = age_days / DAYS_PER_MONTH
    last = _MAX_MONTH[indicator]
    # Последняя строка таблицы — целый месяц (228 = 19 лет); возраст, который
    # до него округляется, ещё оценивается по ней, дальше таблиц ВОЗ нет.
    if age_months >= last + 0.5:
        return None
    if age_months >= last:
        return months.get(last)
    lower = math.floor(age_months)
    if lower == age_months:
        return months.get(lower)
    lo, hi = months.get(lower), months.get(lower + 1)
    if lo is None or hi is None:
        return None
    # Таблица 2007 года дана по целым месяцам; между ними параметры
    # интерполируются линейно — кривые ВОЗ гладкие, шаг в месяц мал.
    t = age_months - lower
    return Lms(
        lo.l + (hi.l - lo.l) * t,
        lo.m + (hi.m - lo.m) * t,
        lo.s + (hi.s - lo.s) * t,
    )


def _value_at(p: Lms, z: float) -> float:
    """Измерение, соответствующее z-баллу по LMS-кривой."""

    if p.l == 0:
        return p.m * math.exp(p.s * z)
    return p.m * math.pow(1 + p.l * p.s * z, 1 / p.l)


def _lms_z(p: Lms, value: float) -> float:
    if p.l == 0:
        return math.log(value / p.m) / p.s
    return (math.pow(value / p.m, p.l) - 1) / (p.l * p.s)


def zscore(indicator: Indicator, sex: SexCode, age_days: int, value: float) -> float | None:
    """Z-балл измерения (кг, см или кг/м²) для пола и возраста в днях.

    ``None`` — возраст вне таблиц ВОЗ (вес к возрасту — до 10 лет, рост и
    ИМТ — до 19) или измерение не положительно.
    """

    if value <= 0:
        return None
    p = lms_at(indicator, sex, age_days)
    if p is None:
        return None
    z = _lms_z(p, value)
    if indicator not in _RESTRICTED:
        return z
    if z > 3:
        sd3 = _value_at(p, 3)
        sd23 = sd3 - _value_at(p, 2)
        return 3 + (value - sd3) / sd23
    if z < -3:
        sd3 = _value_at(p, -3)
        sd23 = _value_at(p, -2) - sd3
        return -3 + (value - sd3) / sd23
    return z


def bmi(weight_kg: float, height_cm: float) -> float:
    """ИМТ, кг/м²."""

    metres = height_cm / 100
    return weight_kg / (metres * metres)


def percentile(z: float) -> float:
    """Перцентиль (0-100) по стандартному нормальному распределению."""

    return 50 * (1 + math.erf(z / math.sqrt(2)))


def significant_drop(baseline_z: float, current_z: float) -> bool:
    """Снизился ли z-балл от исходного на значимую величину (вопрос 15)."""

    # Округление гасит хвост плавающей точки: 1.0 SD, посчитанный как
    # 0.9999999999, — это ровно та граница, которую назвала клиника.
    return round(baseline_z - current_z, 9) >= SIGNIFICANT_DROP_SD
