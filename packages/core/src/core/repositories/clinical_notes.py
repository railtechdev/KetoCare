"""Репозиторий врачебных заметок (раздел 4.2 ТЗ).

Заметка — свидетельство того, что врач думал и видел в конкретный момент.
Поэтому здесь только добавление и чтение: методов изменения и удаления нет и
быть не должно, как и в `prescriptions` (правило 4 CLAUDE.md). Ошибочная запись
исправляется следующей заметкой, а не правкой предыдущей.
"""

from __future__ import annotations

import uuid

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ClinicalNote


async def list_for_patient(
    session: AsyncSession, *, patient_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> tuple[list[ClinicalNote], int]:
    condition = (ClinicalNote.patient_id == patient_id, ClinicalNote.deleted_at.is_(None))

    stmt = (
        select(ClinicalNote)
        .where(*condition)
        .order_by(desc(ClinicalNote.created_at))
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(ClinicalNote).where(*condition))
    return items, int(total or 0)


async def create(
    session: AsyncSession, *, patient_id: uuid.UUID, author_id: uuid.UUID, text: str
) -> ClinicalNote:
    note = ClinicalNote(patient_id=patient_id, author_id=author_id, text=text)
    session.add(note)
    await session.flush()
    return note
