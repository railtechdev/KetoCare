"""`/prescriptions` — назначения (раздел 5.3 ТЗ).

Append-only: POST создаёт новую версию, ручек изменения/удаления нет.
Каждое создание пишется в audit_log (раздел 4.2 ТЗ).
"""

from __future__ import annotations

import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Path

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import prescriptions as prescriptions_repo
from keto_engine import max_non_fat_grams

from ..deps.auth import PatientAccessDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import Page, PrescriptionCreate, PrescriptionRead
from ..services import queue as queue_service

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/patients/{patient_id}/prescriptions", tags=["prescriptions"])


@router.get("", response_model=Page[PrescriptionRead], summary="История назначений")
async def list_prescriptions(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
    page: PaginationDep,
) -> Page[PrescriptionRead]:
    items, total = await prescriptions_repo.list_history(
        session, patient_id=patient_id, limit=page.limit, offset=page.offset
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
    # Диапазоны отдельных полей проверяет схема PrescriptionCreate по разделу 8.3 ТЗ
    # (ratio 1.0-5.0, kcal 500-3000). Правил «правдоподобности» сочетаний здесь нет:
    # медицинские правила не выдумываются (правило 1 CLAUDE.md), вопрос вынесен в
    # OPEN_QUESTIONS.md.
    #
    # Проверяется только арифметическая выполнимость: из определения соотношения
    # F = R·(P+C) и коэффициентов Атуотера следует P+C = kcal/(9R+4). Цель по белку
    # выше этой величины недостижима ни при каком наборе продуктов — это тождество,
    # а не медицинское суждение, и назначение с такой опечаткой семья физически не
    # сможет выполнить.
    max_protein_and_carbs = max_non_fat_grams(payload.ratio, float(payload.kcal_per_day))
    if payload.protein_g > max_protein_and_carbs:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"При соотношении {payload.ratio:g}:1 и {payload.kcal_per_day} ккал в сутки "
            f"на белки и углеводы приходится не более {max_protein_and_carbs:.1f} г, "
            f"а цель по белку — {payload.protein_g:g} г. Проверьте значения.",
            details={
                "protein_g": payload.protein_g,
                "max_protein_and_carbs_g": round(max_protein_and_carbs, 1),
            },
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

    # Семья узнаёт о новом назначении в тот же день (раздел 5.4 ТЗ): сутки
    # готовки по старому кетосоотношению — это сутки не той терапии.
    #
    # Отказ очереди не отменяет назначение: оно уже записано и уже действует.
    # Уронить ручку значит потерять запись врача из-за недоступного Redis.
    try:
        # В задачу уходит только ребёнок: сами цифры боту не нужны и по разделу
        # 7.5 ТЗ ему запрещены — он зовёт открыть кабинет, а не пересказывает
        # назначение.
        await queue_service.enqueue("notify_family", str(patient_id))
    except Exception as exc:  # noqa: BLE001 — причина не важна, важно не потерять назначение
        logger.warning("notify_family_not_queued", patient_id=str(patient_id), reason=str(exc))

    return PrescriptionRead.model_validate(prescription)
