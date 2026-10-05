"""Схемы клинических ручек врача: медицинский профиль, препараты, заметки.

Поля и их состав — раздел 4.2 ТЗ. Ограничения длины здесь — защита от
произвольно больших тел запроса, а не медицинские правила.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from core.control_schedule import ControlPurpose
from core.models.enums import MedicationDoseUnit, MedicationFrequency, TherapyEndReason

from .schemas import RequiredLongText, RequiredName

# --- medical profile ------------------------------------------------------


class Genetics(BaseModel):
    """`medical_profiles.genetics` — {gene, variant, interpretation} (раздел 4.2 ТЗ)."""

    model_config = ConfigDict(extra="forbid")

    gene: str | None = Field(default=None, max_length=100)
    variant: str | None = Field(default=None, max_length=255)
    interpretation: str | None = Field(default=None, max_length=2000)


class MedicalProfileWrite(BaseModel):
    """PUT заменяет профиль целиком: не переданное поле становится пустым.

    Профиль один на пациента, отдельного POST нет — тело всегда описывает
    состояние целиком, поэтому частичное обновление здесь невозможно по смыслу.
    """

    model_config = ConfigDict(extra="forbid")

    diagnosis: str | None = Field(default=None, max_length=2000)
    epilepsy_type: str | None = Field(default=None, max_length=255)
    # Верхняя граница — 100 лет в месяцах: это проверка правдоподобности ввода
    # (защита от опечатки вроде «36000»), а не медицинская константа.
    onset_age_months: Annotated[int, Field(ge=0, le=1200)] | None = None
    genetics: Genetics | None = None
    comorbidities: str | None = Field(default=None, max_length=2000)
    # Врачебная часть анкеты регистрации (ADR-0007): вариант шкалы
    # `aed_switch_count` из `/dictionaries/intake-options`.
    aed_switch_count_id: uuid.UUID | None = None
    # Дата начала кетодиетотерапии — ответ клиники 09.09.2026 (вопрос 17).
    # Будущая дата разрешена намеренно: врач назначает диету с понедельника, и
    # запрет означал бы, что дату нельзя внести заранее. Проверка на
    # правдоподобность — в сервисе (`check_therapy_start_is_plausible`).
    therapy_started_on: date | None = None


class MedicalProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    diagnosis: str | None
    epilepsy_type: str | None
    onset_age_months: int | None
    genetics: Genetics | None
    comorbidities: str | None
    aed_switch_count_id: uuid.UUID | None
    therapy_started_on: date | None
    #: Завершение терапии (вопрос 18, ADR-0050). Ставится не этой формой, а
    #: `PUT /therapy-end`; здесь — только для чтения врачом и диетологом.
    therapy_ended_on: date | None = None
    therapy_end_reason: TherapyEndReason | None = None
    therapy_end_note: str | None = None
    created_at: datetime
    updated_at: datetime


# --- therapy end (вопрос 18, ADR-0050) -------------------------------------


class TherapyEndWrite(BaseModel):
    """Завершение кетодиетотерапии.

    Дата — не в будущем: завершение — свершившийся факт, по которому ребёнок
    уходит из рабочих списков и перестаёт получать напоминания. Запланированное
    окончание — это контрольный визит, а не статус. Дата не раньше начала
    терапии проверяется на сервере по профилю.
    """

    model_config = ConfigDict(extra="forbid")

    ended_on: date
    reason: TherapyEndReason
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None

    @field_validator("note")
    @classmethod
    def _blank_note_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _other_needs_note(self) -> TherapyEndWrite:
        if self.reason is TherapyEndReason.OTHER and not self.note:
            raise ValueError("Для причины «другое» нужно пояснение.")
        return self


# --- control visits (вопросы 17 и 34, ADR-0050) -----------------------------


class ControlVisitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    planned_on: date
    #: Месяц от начала терапии, если визит построен по графику; пусто — визит
    #: назначен врачом вне графика.
    month_offset: int | None
    completed_on: date | None
    note: str | None
    #: Зачем точка сверх обычного визита (оценка эффективности — 6 месяцев,
    #: решение о продолжении — 24 месяца; вопрос 18).
    purpose: ControlPurpose | None = None
    #: Анализы к визиту — перечень клиники (вопрос 34), без значений.
    labs: list[str] = Field(default_factory=list)
    #: Срок прошёл, а визит не отмечен состоявшимся. Порога «просрочки» клиника
    #: не называла (вопрос 17), поэтому это просто факт: дата прошла.
    overdue: bool = False


class ControlVisitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    planned_on: date
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None


class ControlVisitUpdate(BaseModel):
    """Перенос, отметка «состоялся» и пояснение. Не переданное поле не меняется."""

    model_config = ConfigDict(extra="forbid")

    planned_on: date | None = None
    completed_on: date | None = None
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None

    @model_validator(mode="after")
    def _check(self) -> ControlVisitUpdate:
        if not self.model_fields_set:
            raise ValueError("Укажите хотя бы одно поле для изменения.")
        if "planned_on" in self.model_fields_set and self.planned_on is None:
            raise ValueError("Дату визита нельзя очистить — визит можно удалить.")
        return self


class ControlScheduleRead(BaseModel):
    """График контроля пациента целиком: визиты и постоянные перечни анализов."""

    visits: list[ControlVisitRead]
    #: Дата, от которой строится график (слово врача, иначе первое назначение).
    therapy_started_on: date | None
    #: «Еженедельно» — перечень клиники (вопрос 34); срок не назван, поэтому
    #: показывается врачу и не рассылается семье.
    weekly_labs: list[str]
    #: «Каждые 3–6 месяцев» — перечень клиники (вопрос 34).
    periodic_labs: list[str]


# --- medications ----------------------------------------------------------


class MedicationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    drug_name: RequiredName
    #: Разовая доза числом (ADR-0049, вопрос 44; FHIR `doseQuantity.value`).
    #: Обязательна при любой единице, кроме «другой».
    dose_value: Annotated[float, Field(gt=0, le=100_000)] | None = None
    #: Единица из списка — обязательна у каждой новой записи и у каждой правки,
    #: как кратность: запись до списка при правке получает единицу, и выбирает
    #: её врач, а не разбор строки.
    dose_unit: MedicationDoseUnit
    #: Доза словами — только у «другой единицы» («2,5 мг/кг/сут»), и там
    #: обязательна. Строку дозы для чтения сервер собирает сам.
    dose_text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = (
        None
    )
    #: Кратность — из списка (ADR-0033, вопрос 45). Обязательна у каждой новой
    #: записи и у каждой правки: запись, заведённая до списка, при правке
    #: получает код, и выбирает его врач, а не разбор строки.
    frequency_code: MedicationFrequency
    #: Уточнение к кратности («утром и на ночь»). Для «другой схемы» обязательно.
    frequency: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = (
        None
    )
    started_at: date
    stopped_at: date | None = Field(
        default=None, description="Последний день приёма; пусто — препарат принимается"
    )

    @field_validator("frequency", "dose_text")
    @classmethod
    def _blank_note_is_none(cls, value: str | None) -> str | None:
        # Пустое уточнение — это «уточнения нет», а не строка из пробелов в карте.
        return value or None

    @model_validator(mode="after")
    def _check_other_is_described(self) -> MedicationWrite:
        # «Другая схема» без слов не говорит, как давать препарат.
        if self.frequency_code is MedicationFrequency.OTHER and self.frequency is None:
            raise ValueError("Для «Другой схемы» опишите кратность приёма словами.")
        return self

    @model_validator(mode="after")
    def _check_dose(self) -> MedicationWrite:
        # Ровно один способ записать дозу: числом с единицей или словами у
        # «другой единицы». Два сразу разошлись бы — какому верить?
        if self.dose_unit is MedicationDoseUnit.OTHER:
            if self.dose_text is None:
                raise ValueError("Для «другой единицы» опишите дозу словами.")
            if self.dose_value is not None:
                raise ValueError(
                    "У «другой единицы» доза пишется словами; число укажите вместе с единицей."
                )
            return self
        if self.dose_value is None:
            raise ValueError("Укажите дозу числом.")
        if self.dose_text is not None:
            raise ValueError("Доза словами — только для «другой единицы».")
        if round(self.dose_value, 3) != self.dose_value:
            raise ValueError("Доза — не больше трёх знаков после запятой.")
        return self

    @model_validator(mode="after")
    def _check_period(self) -> MedicationWrite:
        # Отрезок приёма с концом раньше начала не описывает ничего: по такой записи
        # нельзя ответить, принимается препарат сегодня или нет.
        if self.stopped_at is not None and self.stopped_at < self.started_at:
            raise ValueError("Дата окончания приёма раньше даты начала.")
        return self


class MedicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    drug_name: str
    #: Доза для чтения: «300 мг», слова у «другой единицы» или строка записи,
    #: заведённой до списка (тогда `dose_unit` пуст).
    dose: str
    dose_value: float | None
    #: Пусто только у записей, заведённых до списка: их доза — строкой в `dose`.
    dose_unit: MedicationDoseUnit | None
    #: Пусто только у записей, заведённых до списка: их кратность — в `frequency`.
    frequency_code: MedicationFrequency | None
    frequency: str | None
    started_at: date
    stopped_at: date | None
    author_id: uuid.UUID
    created_at: datetime


# --- clinical notes -------------------------------------------------------


class ClinicalNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: RequiredLongText


class ClinicalNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    author_id: uuid.UUID
    text: str
    created_at: datetime
