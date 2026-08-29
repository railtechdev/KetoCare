"""Репозиторий схемы лекарственной терапии (раздел 4.2 ТЗ).

Мягкое удаление (правило 4 CLAUDE.md). Отмена препарата и удаление записи —
разные вещи: окончание приёма фиксируется `stopped_at`, строка при этом
остаётся видимой, потому что она объясняет уже записанные `medication_logs`.
`deleted_at` — только для ошибочно заведённых записей.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Medication


async def get(session: AsyncSession, medication_id: uuid.UUID) -> Medication | None:
    medication: Medication | None = await session.scalar(
        select(Medication).where(Medication.id == medication_id, Medication.deleted_at.is_(None))
    )
    return medication


async def list_for_patient(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    active_on: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Medication], int]:
    """История назначенных препаратов, при `active_on` — только принимаемые в этот день.

    Границы включительные: `started_at` — первый день приёма, `stopped_at` — последний.
    """

    condition: list[ColumnElement[bool]] = [
        Medication.patient_id == patient_id,
        Medication.deleted_at.is_(None),
    ]
    if active_on is not None:
        condition.append(Medication.started_at <= active_on)
        condition.append(or_(Medication.stopped_at.is_(None), Medication.stopped_at >= active_on))

    stmt = (
        select(Medication)
        .where(*condition)
        .order_by(Medication.started_at.desc(), Medication.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(Medication).where(*condition))
    return items, int(total or 0)


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    drug_name: str,
    dose: str,
    frequency: str,
    started_at: date,
    stopped_at: date | None,
    author_id: uuid.UUID,
) -> Medication:
    medication = Medication(
        patient_id=patient_id,
        drug_name=drug_name,
        dose=dose,
        frequency=frequency,
        started_at=started_at,
        stopped_at=stopped_at,
        author_id=author_id,
    )
    session.add(medication)
    await session.flush()
    return medication


async def update(
    session: AsyncSession,
    *,
    medication: Medication,
    drug_name: str,
    dose: str,
    frequency: str,
    started_at: date,
    stopped_at: date | None,
) -> Medication:
    """`author_id` не обновляется: это врач, назначивший препарат, а не тот, кто
    последним поправил запись. Кто именно правил — видно в `audit_log`."""

    medication.drug_name = drug_name
    medication.dose = dose
    medication.frequency = frequency
    medication.started_at = started_at
    medication.stopped_at = stopped_at
    await session.flush()
    return medication


async def soft_delete(session: AsyncSession, *, medication: Medication) -> Medication:
    medication.deleted_at = datetime.now(UTC)
    await session.flush()
    return medication
