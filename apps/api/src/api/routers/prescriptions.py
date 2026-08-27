"""`/prescriptions` — назначения (раздел 5.3 ТЗ).

Append-only: POST создаёт новую версию, ручек изменения/удаления нет.
Каждое создание пишется в audit_log (раздел 4.2 ТЗ).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import prescriptions as prescriptions_repo

from ..deps.auth import PatientAccessDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import Page, PrescriptionCreate, PrescriptionRead

router = APIRouter(prefix="/patients/{patient_id}/prescriptions", tags=["prescriptions"])


@router.get("", response_model=Page[PrescriptionRead], summary="История назначений")
async def list_prescriptions(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PrescriptionRead]:
    items, total = await prescriptions_repo.list_history(
        session, patient_id=patient_id, limit=limit, offset=offset
    )
    return Page(items=[PrescriptionRead.model_validate(p) for p in items], total=total)


@router.get("/active", response_model=PrescriptionRead, summary="Активное назначение")
async def get_active_prescription(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> PrescriptionRead:
    prescription = await prescriptions_repo.get_active(session, patient_id=patient_id)
    if prescription is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Назначение ещё не создано.")
    return PrescriptionRead.model_validate(prescription)


@router.post(
    "",
    response_model=PrescriptionRead,
    status_code=201,
    summary="Создать новую версию назначения",
    dependencies=[Depends(require_roles(UserRole.DOCTOR, UserRole.DIETITIAN))],
)
async def create_prescription(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: PrescriptionCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> PrescriptionRead:
    if payload.carbs_limit_g > payload.protein_g * 20:
        # Защита от очевидной опечатки: углеводный лимит на порядок выше белковой цели
        # почти наверняка ошибка ввода, а не назначение.
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Углеводный лимит выглядит несоразмерно большим относительно цели по белку — проверьте значения.",
            details={"carbs_limit_g": payload.carbs_limit_g, "protein_g": payload.protein_g},
        )

    prescription = await prescriptions_repo.create(
        session,
        patient_id=patient_id,
        ratio=payload.ratio,
        kcal_per_day=payload.kcal_per_day,
        protein_g=payload.protein_g,
        carbs_limit_g=payload.carbs_limit_g,
        meals_per_day=payload.meals_per_day,
        author_id=user.id,
        effective_from=payload.effective_from,
        restrictions=payload.restrictions,
    )

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create",
        entity="prescriptions",
        entity_id=prescription.id,
        after={
            "patient_id": str(patient_id),
            "ratio": float(prescription.ratio),
            "kcal_per_day": prescription.kcal_per_day,
            "protein_g": float(prescription.protein_g),
            "carbs_limit_g": float(prescription.carbs_limit_g),
            "meals_per_day": prescription.meals_per_day,
        },
    )

    # TODO(этап 3): поставить задачу воркеру notify_family (раздел 5.4 ТЗ) —
    # ARQ и бот появляются на этапе 3, здесь пока только запись назначения.

    return PrescriptionRead.model_validate(prescription)
