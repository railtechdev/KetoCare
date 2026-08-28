"""Схемы и параметры запросов дневников (раздел 4.2 «Питание и дневники», раздел 5.3 ТЗ).

Шесть видов записей описаны единообразно: общая часть — в базовых классах
`LogCreate`/`LogUpdate`/`LogRead`, специфичные поля — в наследниках, по одному на
таблицу раздела 4.2.

`source` и `created_by` в схемах записи отсутствуют намеренно: канал и автора
проставляет сервер (раздел 5.3 ТЗ). Иначе запись из веба могла бы объявить себя
подтверждённым разбором ИИ (`source=ai_parsed`) или записью другого пользователя.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field

from core.models.enums import DiarySource, KetoneMethod

# Раздел 7.3 ТЗ: «Валидация чисел: кетоны 0–12 ммоль/л, вес 2–150 кг».
# Проверка обязана быть и на сервере: FSM бота — это UX, а не безопасность (правило 5).
KETONE_MIN_MMOL = 0.0
KETONE_MAX_MMOL = 12.0
WEIGHT_MIN_KG = 2.0
WEIGHT_MAX_KG = 150.0

# Ниже — технические, а не медицинские границы. ТЗ не задаёт предельную длительность
# приступа, их число за один эпизод и длину свободного текста, поэтому здесь только
# то, что защищает БД и сервис: int4 не переполняется, текст не растёт бесконечно.
# Медицинские пределы не выдумываются (правило 1 CLAUDE.md).
MAX_DURATION_SEC = 86_400
MAX_SEIZURE_COUNT = 1_000
MAX_TEXT_LEN = 2_000
MAX_SYMPTOM_LEN = 255  # side_effect_logs.symptom — String(255)
MAX_HEIGHT_CM = 250.0  # та же граница, что у PatientCreate.height_cm


def _reject_explicit_null(value: Any) -> Any:
    """PATCH различает «поле не передано» и «передано null».

    Для колонок NOT NULL второе означает попытку стереть обязательное значение —
    отвечаем 422, а не падаем ограничением БД (это был бы 500).
    """

    if value is None:
        raise ValueError("значение не может быть пустым")
    return value


type NotNull[T] = Annotated[T | None, BeforeValidator(_reject_explicit_null)]

OccurredAt = Annotated[AwareDatetime, Field(description="Момент события, со смещением UTC")]
KetoneValue = Annotated[
    float, Field(ge=KETONE_MIN_MMOL, le=KETONE_MAX_MMOL, description="Кетоны, ммоль/л")
]
WeightKg = Annotated[float, Field(ge=WEIGHT_MIN_KG, le=WEIGHT_MAX_KG, description="Вес, кг")]
HeightCm = Annotated[float, Field(gt=0, le=MAX_HEIGHT_CM, description="Рост, см")]
DurationSec = Annotated[int, Field(ge=0, le=MAX_DURATION_SEC, description="Длительность, секунды")]
SeizureCount = Annotated[int, Field(ge=1, le=MAX_SEIZURE_COUNT)]
Symptom = Annotated[str, Field(min_length=1, max_length=MAX_SYMPTOM_LEN)]
FreeText = Annotated[str, Field(max_length=MAX_TEXT_LEN)]


# --- общая часть ----------------------------------------------------------


class LogCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    occurred_at: OccurredAt


class LogUpdate(BaseModel):
    """Частичное обновление: не переданные поля остаются как есть."""

    model_config = ConfigDict(extra="forbid")

    occurred_at: NotNull[OccurredAt] = None


class LogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    occurred_at: datetime
    source: DiarySource
    created_by: uuid.UUID | None
    created_at: datetime


# --- приступы -------------------------------------------------------------


class SeizureLogCreate(LogCreate):
    seizure_type_id: uuid.UUID
    duration_sec: DurationSec | None = None
    count: SeizureCount = 1
    description: FreeText | None = None
    triggers: FreeText | None = None


class SeizureLogUpdate(LogUpdate):
    seizure_type_id: NotNull[uuid.UUID] = None
    duration_sec: DurationSec | None = None
    count: NotNull[SeizureCount] = None
    description: FreeText | None = None
    triggers: FreeText | None = None


class SeizureLogRead(LogRead):
    seizure_type_id: uuid.UUID
    duration_sec: int | None
    count: int
    description: str | None
    triggers: str | None


# --- кетоны ---------------------------------------------------------------


class KetoneLogCreate(LogCreate):
    value: KetoneValue
    method: KetoneMethod


class KetoneLogUpdate(LogUpdate):
    value: NotNull[KetoneValue] = None
    method: NotNull[KetoneMethod] = None


class KetoneLogRead(LogRead):
    value: float
    method: KetoneMethod


# --- вес ------------------------------------------------------------------


class WeightLogCreate(LogCreate):
    weight_kg: WeightKg
    height_cm: HeightCm | None = None


class WeightLogUpdate(LogUpdate):
    weight_kg: NotNull[WeightKg] = None
    height_cm: HeightCm | None = None


class WeightLogRead(LogRead):
    weight_kg: float
    height_cm: float | None


# --- лекарства ------------------------------------------------------------


class MedicationLogCreate(LogCreate):
    medication_id: uuid.UUID
    taken: bool


class MedicationLogUpdate(LogUpdate):
    medication_id: NotNull[uuid.UUID] = None
    taken: NotNull[bool] = None


class MedicationLogRead(LogRead):
    medication_id: uuid.UUID
    taken: bool


# --- еда ------------------------------------------------------------------


class MealLogCreate(LogCreate):
    """`parsed` (результат AI-разбора) через эту схему не принимается: его пишет
    сценарий подтверждения разбора (раздел 5.4 ТЗ), а он появляется на этапе 4."""

    menu_item_id: uuid.UUID | None = None
    free_text: FreeText | None = None


class MealLogUpdate(LogUpdate):
    menu_item_id: uuid.UUID | None = None
    free_text: FreeText | None = None


class MealLogRead(LogRead):
    menu_item_id: uuid.UUID | None
    free_text: str | None
    parsed: dict[str, Any] | None


# --- самочувствие ---------------------------------------------------------


class SideEffectLogCreate(LogCreate):
    symptom: Symptom
    description: FreeText | None = None


class SideEffectLogUpdate(LogUpdate):
    symptom: NotNull[Symptom] = None
    description: FreeText | None = None


class SideEffectLogRead(LogRead):
    symptom: str
    description: str | None


# --- параметры запроса ----------------------------------------------------
