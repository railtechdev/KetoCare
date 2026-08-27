"""`/patients` — профиль пациента (раздел 5.3 ТЗ)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query

from core.models.enums import UserRole
from core.repositories import access as access_repo
from core.repositories import patients as patients_repo

from ..deps.auth import CurrentUserDep, PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas import Page, PatientCreate, PatientRead

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("", response_model=Page[PatientRead], summary="Доступные пациенты")
async def list_patients(
    user: CurrentUserDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PatientRead]:
    """Список ограничен связями пользователя; админ получает пустой список
    (у него нет доступа к клиническим данным, раздел 5.1 ТЗ)."""

    patient_ids = await access_repo.list_accessible_patient_ids(
        session, user_id=user.id, role=user.role
    )

    # Токен Mini App выдаётся на конкретного пациента (раздел 5.2 ТЗ) — список
    # обязан сужаться так же, как и ручки с {patient_id}, иначе scope протекает.
    if user.patient_scope is not None:
        patient_ids = [pid for pid in patient_ids if pid == user.patient_scope]

    items, total = await patients_repo.list_for_ids(
        session, patient_ids=patient_ids, limit=limit, offset=offset
    )
    return Page(items=[PatientRead.model_validate(p) for p in items], total=total)


@router.post("", response_model=PatientRead, status_code=201, summary="Создать профиль ребёнка")
async def create_patient(
    payload: PatientCreate, user: CurrentUserDep, session: SessionDep
) -> PatientRead:
    """Создаёт родитель (при регистрации ребёнка). Автор сразу привязывается к пациенту,
    иначе он не смог бы прочитать только что созданный профиль."""

    if user.role is not UserRole.PARENT:
        raise ApiError(ErrorCode.FORBIDDEN, "Профиль ребёнка создаёт родитель.")

    # Scope-токен ограничен одним уже привязанным пациентом; создание нового
    # ребёнка вышло бы за его пределы.
    if user.patient_scope is not None:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Добавить ребёнка можно только в веб-кабинете.",
        )

    patient = await patients_repo.create(
        session,
        full_name=payload.full_name,
        birth_date=payload.birth_date,
        sex=payload.sex,
        height_cm=payload.height_cm,
        allergies=payload.allergies,
        notes=payload.notes,
    )
    await patients_repo.link_parent(session, parent_id=user.id, patient_id=patient.id)
    return PatientRead.model_validate(patient)


@router.get("/{patient_id}", response_model=PatientRead, summary="Профиль пациента")
async def get_patient(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> PatientRead:
    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")
    return PatientRead.model_validate(patient)
