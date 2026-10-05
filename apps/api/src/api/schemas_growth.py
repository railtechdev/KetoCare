"""Схемы оценки роста и веса по нормам ВОЗ (вопрос 15, ADR-0050)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel


class GrowthScore(BaseModel):
    #: z-балл (SD) относительно нормы ВОЗ для пола и возраста.
    z: float
    #: Перцентиль, 0–100.
    percentile: float


class GrowthPointRead(BaseModel):
    measured_on: date
    age_days: int
    weight_kg: float
    height_cm: float | None
    bmi: float | None
    #: Вес к возрасту. Нет — возраст вне таблиц ВОЗ (вес к возрасту — до 10 лет).
    wfa: GrowthScore | None
    #: Рост (длина тела) к возрасту — только если рост измерен в этой записи.
    hfa: GrowthScore | None
    #: ИМТ к возрасту — только если рост измерен в этой записи.
    bmi_for_age: GrowthScore | None


class GrowthIndicatorRead(BaseModel):
    indicator: Literal["wfa", "hfa", "bmi"]
    #: Исходное значение — на старте терапии (см. `services.growth`).
    baseline_on: date | None = None
    baseline: GrowthScore | None = None
    latest_on: date | None = None
    latest: GrowthScore | None = None
    #: Изменение z-балла от исходного; пусто — сравнивать не с чем.
    change_sd: float | None = None
    #: Снижение на порог клиники или больше (вопрос 15: ≥ 1,0 SD).
    significant_drop: bool = False


class GrowthRead(BaseModel):
    points: list[GrowthPointRead]
    indicators: list[GrowthIndicatorRead]
    significant_drop_sd: float
    #: Название и версия таблиц ВОЗ — врач должен видеть, по чему посчитано.
    source: str
