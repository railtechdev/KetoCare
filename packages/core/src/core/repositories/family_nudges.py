"""Просьбы специалиста к семье отметить дневник (ADR-0046).

Предел «раз в сутки на ребёнка» считается по этой таблице. Проверка и запись
идут под блокировкой строки ребёнка: два врача, нажавшие кнопку в одну
секунду, иначе оба прошли бы проверку и семья получила бы два сообщения.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import FamilyNudge, Patient


async def lock_patient(session: AsyncSession, patient_id: uuid.UUID) -> None:
    """Держать строку ребёнка до конца транзакции — проверка и запись атомарны."""

    await session.execute(select(Patient.id).where(Patient.id == patient_id).with_for_update())


async def last_since(
    session: AsyncSession, *, patient_id: uuid.UUID, since: datetime
) -> FamilyNudge | None:
    """Последняя просьба к семье этого ребёнка не раньше `since`."""

    stmt = (
        select(FamilyNudge)
        .where(FamilyNudge.patient_id == patient_id, FamilyNudge.created_at >= since)
        .order_by(FamilyNudge.created_at.desc())
        .limit(1)
    )
    nudge: FamilyNudge | None = await session.scalar(stmt)
    return nudge


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    requested_by: uuid.UUID,
    recipients: int,
    created_at: datetime,
) -> FamilyNudge:
    nudge = FamilyNudge(
        patient_id=patient_id,
        requested_by=requested_by,
        recipients=recipients,
        created_at=created_at,
    )
    session.add(nudge)
    await session.flush()
    return nudge
