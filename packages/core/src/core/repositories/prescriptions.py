"""Репозиторий назначений — append-only (правило 4 CLAUDE.md, раздел 4.2 ТЗ).

Изменение назначения = новая строка. UPDATE/DELETE запрещены на уровне
репозитория: методов, выполняющих их, здесь нет и быть не должно.
Активное назначение = последнее по created_at.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Prescription


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    ratio: float,
    kcal_per_day: int,
    protein_g: float,
    carbs_limit_g: float,
    meals_per_day: int,
    author_id: uuid.UUID,
    effective_from: date,
    restrictions: str | None = None,
) -> Prescription:
    """Создаёт НОВУЮ версию назначения. Существующие строки не трогает."""

    prescription = Prescription(
        patient_id=patient_id,
        ratio=ratio,
        kcal_per_day=kcal_per_day,
        protein_g=protein_g,
        carbs_limit_g=carbs_limit_g,
        meals_per_day=meals_per_day,
        restrictions=restrictions,
        author_id=author_id,
        effective_from=effective_from,
    )
    session.add(prescription)
    await session.flush()
    return prescription


async def get_active(session: AsyncSession, *, patient_id: uuid.UUID) -> Prescription | None:
    """Активное назначение — последнее по created_at (раздел 4.2 ТЗ)."""

    stmt = (
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .order_by(desc(Prescription.created_at))
        .limit(1)
    )
    result: Prescription | None = await session.scalar(stmt)
    return result


async def list_history(
    session: AsyncSession, *, patient_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> tuple[list[Prescription], int]:
    stmt = (
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .order_by(desc(Prescription.created_at))
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))

    total = await session.scalar(
        select(func.count()).select_from(Prescription).where(Prescription.patient_id == patient_id)
    )
    return items, int(total or 0)
