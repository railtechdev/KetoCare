"""Схемы анкеты регистрации пациента и её справочников (ADR-0007).

Анкета собирает то, что заказчик перечислил в документе от 29.08.2026. Ответы
семьи и ответы врача разведены по разным таблицам, поэтому и схемы разные:
врачебное поле (число сменённых ПЭП) живёт в `schemas_clinical`, здесь — только
то, что заполняет семья.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from core.models.enums import IntakeScale


class IntakeOptionRead(BaseModel):
    """Вариант ответа одной из шкал анкеты.

    `code` отдаётся вместе с названием: по нему собирается статистика, и
    переформулировка варианта медицинской командой не должна её обнулять.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    scale: IntakeScale
    code: str
    name_ru: str
    sort: int


class AedDrugRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name_ru: str
    synonyms: list[str]
    sort: int


class PatientIntakeWrite(BaseModel):
    """PUT заменяет анкету целиком: не переданное поле становится пустым.

    Анкета одна на пациента, отдельного POST нет — тело всегда описывает
    состояние целиком, как и у медицинского профиля.
    """

    model_config = ConfigDict(extra="forbid")

    last_seizure_on: date | None = Field(
        default=None,
        description="Дата последнего приступа на момент анкеты; дальше считается по дневнику",
    )
    onset_age_id: uuid.UUID | None = None
    seizure_frequency_id: uuid.UUID | None = None
    seizure_duration_id: uuid.UUID | None = None
    meals_per_day_id: uuid.UUID | None = None
    developmental_delay: bool | None = None
    meals_regular: bool | None = None
    # Ограничение сверху — защита от произвольно большого тела запроса, а не
    # медицинское правило: справочник заказчика содержит 16 позиций.
    current_aed_ids: list[uuid.UUID] = Field(default_factory=list, max_length=64)


class PatientIntakeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    last_seizure_on: date | None
    onset_age_id: uuid.UUID | None
    seizure_frequency_id: uuid.UUID | None
    seizure_duration_id: uuid.UUID | None
    meals_per_day_id: uuid.UUID | None
    developmental_delay: bool | None
    meals_regular: bool | None
    current_aed_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime
