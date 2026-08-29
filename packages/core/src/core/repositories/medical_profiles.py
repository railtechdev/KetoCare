"""Репозиторий медицинского профиля пациента (раздел 4.2 ТЗ).

Профиль один на пациента (`unique(patient_id)`), поэтому запись выполняется
upsert'ом: отдельной ручки создания нет, PUT либо создаёт строку, либо
перезаписывает существующую.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MedicalProfile


async def get_for_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> MedicalProfile | None:
    """Профиль пациента, если он есть и не удалён мягко (раздел 4.1 ТЗ)."""

    profile: MedicalProfile | None = await session.scalar(
        select(MedicalProfile).where(
            MedicalProfile.patient_id == patient_id,
            MedicalProfile.deleted_at.is_(None),
        )
    )
    return profile


async def upsert(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    diagnosis: str | None,
    epilepsy_type: str | None,
    onset_age_months: int | None,
    genetics: dict[str, Any] | None,
    comorbidities: str | None,
) -> MedicalProfile:
    """Создаёт профиль или полностью перезаписывает существующий."""

    # Здесь, в отличие от get_for_patient, строка ищется БЕЗ фильтра по deleted_at:
    # уникальный индекс по patient_id распространяется и на мягко удалённые строки,
    # поэтому вставка поверх удалённого профиля упала бы на ограничении БД (500
    # вместо сохранённого профиля). Мягко удалённый профиль возвращается к жизни.
    profile: MedicalProfile | None = await session.scalar(
        select(MedicalProfile).where(MedicalProfile.patient_id == patient_id)
    )

    if profile is None:
        profile = MedicalProfile(patient_id=patient_id)
        session.add(profile)

    profile.diagnosis = diagnosis
    profile.epilepsy_type = epilepsy_type
    profile.onset_age_months = onset_age_months
    profile.genetics = genetics
    profile.comorbidities = comorbidities
    profile.deleted_at = None

    await session.flush()

    # UPDATE помечает `updated_at` (onupdate=now()) устаревшим, и его значение
    # подгружается ленивым запросом при первом обращении. В асинхронной сессии
    # ленивая подгрузка вне await'а падает (MissingGreenlet), а обращается к полю
    # уже сериализатор ответа — поэтому значение дочитывается здесь явно.
    await session.refresh(profile)
    return profile
