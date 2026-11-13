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
from keto_engine import max_non_fat_grams, meal_macro_goal

from .. import after_commit
from ..deps.auth import PatientAccessDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import Page, PrescriptionCreate, PrescriptionRead

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
    # F = R·(P + Cnet) и коэффициентов Атуотера следует, что белок ни при каком
    # наборе продуктов не превысит kcal/(9R+4). Это тождество, а не медицинское
    # суждение, и назначение с такой опечаткой семья физически не сможет выполнить.
    #
    # Говорить в сообщении «на белки и углеводы приходится не более N г» больше
    # нельзя: с 1.0.0 знаменатель соотношения — ЧИСТЫЕ углеводы (ADR-0030), и
    # блюдо с клетчаткой спокойно даёт больше N г белка с общими углеводами. Под
    # предел попадает именно цель по белку, о ней и речь.
    max_protein = max_non_fat_grams(payload.ratio, float(payload.kcal_per_day))
    if payload.protein_g > max_protein:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"При соотношении {payload.ratio:g}:1 и {payload.kcal_per_day} ккал в сутки "
            f"цель по белку не может быть больше {max_protein:.1f} г, "
            f"а задано {payload.protein_g:g} г. Проверьте значения.",
            details={
                "protein_g": payload.protein_g,
                "max_protein_g": round(max_protein, 1),
            },
        )

    # Лимит углеводов не может быть выше того, что остаётся после белка: при
    # соотношении R и калорийности K на белок с чистыми углеводами приходится
    # K/(9R+4) г, и всё сверх этого — число, которого рацион не наберёт, не
    # нарушив соотношение или калорийность. Такой лимит ничего не ограничивает,
    # а семья видит его как разрешение. Так у пациента стояло 27,7 г при
    # расчётных 6,7 г — остаток прежней калорийности (замечание медиков и аудит
    # расчётов 13.11.2026). Ниже расчётного — можно: это более строгий выбор
    # врача, белка в рационе тогда будет больше цели.
    #
    # Сравнение — с числом, которое форма показывает врачу (до десятых), поэтому
    # допуск на округление 0,05 г.
    derived = meal_macro_goal(
        payload.ratio,
        float(payload.kcal_per_day),
        day_protein_g=payload.protein_g,
        day_kcal=float(payload.kcal_per_day),
    ).net_carbs_g
    if derived is not None and payload.carbs_limit_g > derived + 0.05 + 1e-9:
        derived_text = f"{derived:.1f}".replace(".", ",")
        limit_text = f"{payload.carbs_limit_g:g}".replace(".", ",")
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"При соотношении {payload.ratio:g}:1, {payload.kcal_per_day} ккал в сутки "
            f"и белке {payload.protein_g:g} г на углеводы остаётся {derived_text} г, "
            f"а лимит задан {limit_text} г. Лимит выше расчётного рацион не наберёт, "
            "не нарушив соотношение или калорийность. Укажите не больше "
            f"{derived_text} г.",
            details={
                "carbs_limit_g": payload.carbs_limit_g,
                "max_carbs_limit_g": round(derived, 1),
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
        fluid_ml_per_day=payload.fluid_ml_per_day,
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
            "fluid_ml_per_day": prescription.fluid_ml_per_day,
        },
    )

    # Семья узнаёт о новом назначении в тот же день (раздел 5.4 ТЗ): сутки
    # готовки по старому кетосоотношению — это сутки не той терапии.
    #
    # Только после коммита: иначе откатившееся назначение успело бы позвать
    # семью открыть то, чего нет. Отказ очереди назначение не отменяет —
    # `run_deferred` это проглатывает и пишет в журнал. В задачу уходит только
    # ребёнок: сами цифры боту по разделу 7.5 ТЗ запрещены.
    after_commit.defer(session, "notify_family", str(patient_id))

    return PrescriptionRead.model_validate(prescription)
