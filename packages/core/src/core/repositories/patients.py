"""Репозиторий пациентов."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DoctorPatient, ParentPatient, Patient
from ..models.enums import Sex


async def get(session: AsyncSession, patient_id: uuid.UUID) -> Patient | None:
    return await session.get(Patient, patient_id)


async def create(
    session: AsyncSession,
    *,
    full_name: str,
    birth_date: date,
    sex: Sex,
    height_cm: float | None = None,
    allergies: list[str] | None = None,
    notes: str | None = None,
) -> Patient:
    patient = Patient(
        full_name=full_name,
        birth_date=birth_date,
        sex=sex,
        height_cm=height_cm,
        allergies=allergies or [],
        notes=notes,
    )
    session.add(patient)
    await session.flush()
    return patient


async def update(session: AsyncSession, *, patient: Patient, **fields: Any) -> Patient:
    for key, value in fields.items():
        setattr(patient, key, value)
    await session.flush()
    return patient


async def link_parent(
    session: AsyncSession, *, parent_id: uuid.UUID, patient_id: uuid.UUID
) -> ParentPatient:
    link = ParentPatient(parent_id=parent_id, patient_id=patient_id)
    session.add(link)
    await session.flush()
    return link


async def link_doctor(
    session: AsyncSession, *, doctor_id: uuid.UUID, patient_id: uuid.UUID
) -> DoctorPatient:
    link = DoctorPatient(doctor_id=doctor_id, patient_id=patient_id)
    session.add(link)
    await session.flush()
    return link


async def list_for_ids(
    session: AsyncSession, *, patient_ids: list[uuid.UUID], limit: int = 50, offset: int = 0
) -> tuple[list[Patient], int]:
    if not patient_ids:
        return [], 0

    condition = Patient.id.in_(patient_ids)
    stmt = select(Patient).where(condition).order_by(Patient.full_name).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(Patient).where(condition))
    return items, int(total or 0)
