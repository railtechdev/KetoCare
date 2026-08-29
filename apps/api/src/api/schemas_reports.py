"""Схемы отчёта по пациенту за период (раздел 5.3 ТЗ, `/reports`).

Отчёт — единственное место, где данные пациента покидают продукт: их печатают,
пересылают, показывают на консилиуме. Поэтому он собирается из тех же
репозиториев, что и экраны, и ничего не считает заново: расхождение между тем,
что врач видел на экране, и тем, что напечаталось, — клинический риск.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ReportPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_date: date
    to_date: date


class ReportPatient(BaseModel):
    """Кто. ФИО остаётся: отчёт читает человек, у которого доступ к пациенту уже есть."""

    id: uuid.UUID
    full_name: str
    birth_date: date
    sex: str
    height_cm: float | None


class ReportPrescription(BaseModel):
    """Действовавшее назначение. Их за период бывает несколько — отчёт перечисляет все."""

    ratio: float
    kcal_per_day: int
    protein_g: float
    carbs_limit_g: float
    meals_per_day: int
    effective_from: date
    created_at: datetime


class SeizureByType(BaseModel):
    seizure_type_id: uuid.UUID
    name_ru: str
    code: str | None
    entries: int
    count: int


class SeizureSection(BaseModel):
    """Приступы за период.

    `entries` и `count` разведены намеренно: одна запись дневника описывает
    серию (`seizure_logs.count`), и подмена приступов записями занизила бы
    картину — та же оговорка, что в сводке главной.
    """

    entries: int
    count: int
    by_type: list[SeizureByType]
    by_day: dict[str, int]


class MeasurementSeries(BaseModel):
    """Ряд измерений: значения по времени плюс сводные числа."""

    points: list[MeasurementPoint]
    min: float | None
    max: float | None
    mean: float | None


class MeasurementPoint(BaseModel):
    at: datetime
    value: float


class MedicationRow(BaseModel):
    drug_name: str
    dose: str
    frequency: str
    started_at: date
    stopped_at: date | None


class SideEffectRow(BaseModel):
    occurred_at: datetime
    symptom: str
    description: str | None


class MenuAdherence(BaseModel):
    """Насколько план дня выполнялся.

    Считается по отметкам «съедено» в позициях меню: без них отчёт сообщал бы,
    что день был спланирован, но не что он состоялся.
    """

    days_planned: int
    items_planned: int
    items_eaten: int


class DoctorSummaryRow(BaseModel):
    """Только подтверждённая врачом сводка.

    В отчёт попадает `approved_md`, черновик — никогда (правило 6 CLAUDE.md:
    ни один результат Claude не становится клиническими данными без человека).
    """

    period_start: date
    period_end: date
    approved_md: str


class PatientReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: datetime
    period: ReportPeriod
    patient: ReportPatient
    prescriptions: list[ReportPrescription]
    seizures: SeizureSection
    ketones: MeasurementSeries
    weight: MeasurementSeries
    medications: list[MedicationRow]
    side_effects: list[SideEffectRow]
    menu: MenuAdherence
    summaries: list[DoctorSummaryRow]


MeasurementSeries.model_rebuild()
