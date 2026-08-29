"""Схемы сводки для главной (раздел 5.3 ТЗ, раздел 8.3 «Родитель / Главная»).

Один ответ на весь экран: назначение, итоги дня против него, последние кетоны и
вес, приступы за сегодня. Любая часть может отсутствовать — это нормальное
состояние семьи, которая только начала вести дневник, а не ошибка.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from core.models.enums import KetoneMethod

from .schemas import DishComputed, PrescriptionRead


class DayTolerance(BaseModel):
    """Соответствие итогов дня назначению.

    Считается `keto_engine.within_tolerance`: сами допуски — медицинские
    константы ядра (правило 2 CLAUDE.md), API их не знает и не дублирует.
    """

    ratio_within_tolerance: bool
    kcal_within_tolerance: bool


class DaySummary(BaseModel):
    """Итоги дня из `menus.totals` — те же показатели, что у блюда, поэтому схема
    `DishComputed` переиспользуется, а не копируется (как в `MenuRead.totals`).

    Значения не пересчитываются при чтении: их считает ядро при сохранении меню и
    хранит вместе с `engine_version`. Второй расчёт здесь дал бы два источника
    одних и тех же чисел, которые разойдутся при первом изменении ядра.
    """

    totals: DishComputed
    # null, пока нет активного назначения: сравнивать итоги не с чем
    tolerance: DayTolerance | None = None
    engine_version: str | None = None


class KetoneReading(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    value: float
    method: KetoneMethod
    occurred_at: datetime


class WeightReading(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    weight_kg: float
    occurred_at: datetime


class SeizuresToday(BaseModel):
    """`entries` — записей в дневнике, `count` — сумма их поля `count`.

    Разделены намеренно: одна запись может описывать серию приступов, и подменять
    число приступов числом записей — занижать клиническую картину.
    """

    model_config = ConfigDict(from_attributes=True)

    entries: int
    count: int


class PatientOverview(BaseModel):
    patient_id: uuid.UUID
    # Дата, за которую посчитаны итоги и приступы, — местная (settings.tz), не UTC
    date: date
    prescription: PrescriptionRead | None = None
    # null, если меню на сегодня нет или итоги по нему ещё не сохранены
    day: DaySummary | None = None
    last_ketone: KetoneReading | None = None
    last_weight: WeightReading | None = None
    seizures_today: SeizuresToday
