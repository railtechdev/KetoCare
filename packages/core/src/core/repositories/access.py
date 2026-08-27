"""Проверка связи пользователя с пациентом (раздел 5.1 ТЗ).

Единственный источник правды о том, кто имеет доступ к данным пациента.
Правило 5 (CLAUDE.md): разграничение доступа проверяется на сервере.
Админ к клиническим данным доступа НЕ имеет.
"""

from __future__ import annotations

import uuid

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DoctorPatient, ParentPatient
from ..models.enums import UserRole


async def user_has_patient_access(
    session: AsyncSession, *, user_id: uuid.UUID, role: UserRole, patient_id: uuid.UUID
) -> bool:
    """True, если пользователь связан с пациентом.

    `admin` не получает доступ к клиническим данным ни при каких условиях —
    у него отдельные ручки `/admin` (раздел 5.3 ТЗ).
    """

    if role is UserRole.PARENT:
        stmt = select(
            exists().where(
                ParentPatient.parent_id == user_id,
                ParentPatient.patient_id == patient_id,
            )
        )
    elif role in (UserRole.DOCTOR, UserRole.DIETITIAN):
        stmt = select(
            exists().where(
                DoctorPatient.doctor_id == user_id,
                DoctorPatient.patient_id == patient_id,
            )
        )
    else:
        return False

    return bool(await session.scalar(stmt))


async def list_accessible_patient_ids(
    session: AsyncSession, *, user_id: uuid.UUID, role: UserRole
) -> list[uuid.UUID]:
    if role is UserRole.PARENT:
        stmt = select(ParentPatient.patient_id).where(ParentPatient.parent_id == user_id)
    elif role in (UserRole.DOCTOR, UserRole.DIETITIAN):
        stmt = select(DoctorPatient.patient_id).where(DoctorPatient.doctor_id == user_id)
    else:
        return []

    return list(await session.scalars(stmt))
