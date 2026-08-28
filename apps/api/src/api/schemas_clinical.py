"""Схемы клинических ручек врача: медицинский профиль, препараты, заметки.

Поля и их состав — раздел 4.2 ТЗ. Ограничения длины здесь — защита от
произвольно больших тел запроса, а не медицинские правила.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class MedicalProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    diagnosis: str | None
    epilepsy_type: str | None
    onset_age_months: int | None
    genetics: Genetics | None
    comorbidities: str | None
    created_at: datetime
    updated_at: datetime


# --- medications ----------------------------------------------------------


class MedicationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    drug_name: RequiredName
    dose: RequiredName
    frequency: RequiredName
    started_at: date
    stopped_at: date | None = Field(
        default=None, description="Последний день приёма; пусто — препарат принимается"
    )

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
    dose: str
    frequency: str
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
