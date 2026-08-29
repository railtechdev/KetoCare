"""Анкета регистрации пациента и её справочники (ADR-0007).

Ответы семьи (`patient_intake`) и справочники вариантов (`intake_options`,
`aed_drugs`). Врачебная часть анкеты — число сменённых ПЭП — живёт в
`medical_profiles` и правится своим репозиторием: разделение по таблицам и есть
разделение права записи (правило 5 CLAUDE.md).

Анкета — одна строка на пациента: она заполняется при заведении ребёнка и
дальше уточняется, а не накапливается версиями. Поэтому здесь `upsert`, а не
`create` + `update`: вызывающему не нужно знать, первый это ответ или третий.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AedDrug, IntakeOption, PatientIntake
from ..models.enums import IntakeScale


async def list_options(
    session: AsyncSession, *, scale: IntakeScale | None = None
) -> list[IntakeOption]:
    """Варианты ответов: все или одной шкалы.

    Порядок — по `sort`, затем по коду: `sort` задаёт администратор, дубликаты
    в нём допустимы, а порядок вариантов между запросами меняться не должен —
    иначе шкала в анкете каждый раз выглядит по-новому.
    """

    stmt = select(IntakeOption)
    if scale is not None:
        stmt = stmt.where(IntakeOption.scale == scale)
    stmt = stmt.order_by(IntakeOption.sort, IntakeOption.code)
    return list(await session.scalars(stmt))


async def list_drugs(
    session: AsyncSession, *, limit: int = 100, offset: int = 0
) -> tuple[list[AedDrug], int]:
    stmt = select(AedDrug).order_by(AedDrug.sort, AedDrug.name_ru).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(AedDrug))
    return items, int(total or 0)


async def get_for_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> PatientIntake | None:
    intake: PatientIntake | None = await session.scalar(
        select(PatientIntake).where(PatientIntake.patient_id == patient_id)
    )
    return intake


async def upsert(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    last_seizure_on: date | None,
    onset_age_id: uuid.UUID | None,
    seizure_frequency_id: uuid.UUID | None,
    seizure_duration_id: uuid.UUID | None,
    meals_per_day_id: uuid.UUID | None,
    developmental_delay: bool | None,
    meals_regular: bool | None,
    current_aed_ids: list[uuid.UUID],
) -> PatientIntake:
    intake = await get_for_patient(session, patient_id=patient_id)
    if intake is None:
        intake = PatientIntake(patient_id=patient_id)
        session.add(intake)

    intake.last_seizure_on = last_seizure_on
    intake.onset_age_id = onset_age_id
    intake.seizure_frequency_id = seizure_frequency_id
    intake.seizure_duration_id = seizure_duration_id
    intake.meals_per_day_id = meals_per_day_id
    intake.developmental_delay = developmental_delay
    intake.meals_regular = meals_regular
    # UUID в JSONB не сериализуется — храним строками, как и приходит из API.
    intake.current_aed_ids = [str(drug_id) for drug_id in current_aed_ids]

    await session.flush()
    return intake
