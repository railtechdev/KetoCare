"""`/patients/{patient_id}/logs/{kind}` — дневники семьи (раздел 5.3 ТЗ).

Шесть видов записей (приступы, кетоны, вес, лекарства, еда, самочувствие) живут
по единому образцу: GET (фильтр по периоду + пагинация), POST, PATCH, DELETE.
Ручки тонкие: вся общая логика — в `services.logs`, доступ к БД — в
`core.repositories.diary`. Отдельная ручка на вид записи, а не один обработчик с
`{kind}` в пути, — чтобы OpenAPI (а значит и сгенерированный `api-client`) знал
точный набор полей каждого дневника.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Response

from core.models import KetoneLog, MealLog, MedicationLog, SeizureLog, SideEffectLog, WeightLog

from ..deps.auth import PatientAccessDep, SessionDep
from ..deps.query import PaginationDep, PeriodDep
from ..schemas import Page
from ..schemas_logs import (
    KetoneLogCreate,
    KetoneLogRead,
    KetoneLogUpdate,
    MealLogCreate,
    MealLogRead,
    MealLogUpdate,
    MedicationLogCreate,
    MedicationLogRead,
    MedicationLogUpdate,
    SeizureLogCreate,
    SeizureLogRead,
    SeizureLogUpdate,
    SideEffectLogCreate,
    SideEffectLogRead,
    SideEffectLogUpdate,
    WeightLogCreate,
    WeightLogRead,
    WeightLogUpdate,
)
from ..services import logs as logs_service

router = APIRouter(prefix="/patients/{patient_id}/logs", tags=["logs"])

PatientIdPath = Annotated[uuid.UUID, Path()]
LogIdPath = Annotated[uuid.UUID, Path()]


# --- приступы -------------------------------------------------------------


@router.get("/seizures", response_model=Page[SeizureLogRead], summary="Дневник приступов")
async def list_seizure_logs(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    period: PeriodDep,
    page: PaginationDep,
) -> Page[SeizureLogRead]:
    return await logs_service.list_logs(
        session, SeizureLog, SeizureLogRead, patient_id=patient_id, period=period, page=page
    )


@router.post(
    "/seizures", response_model=SeizureLogRead, status_code=201, summary="Записать приступ"
)
async def create_seizure_log(
    patient_id: PatientIdPath,
    payload: SeizureLogCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> SeizureLogRead:
    return await logs_service.create_log(
        session, SeizureLog, SeizureLogRead, patient_id=patient_id, payload=payload, author=user
    )


@router.patch(
    "/seizures/{log_id}", response_model=SeizureLogRead, summary="Изменить запись о приступе"
)
async def update_seizure_log(
    patient_id: PatientIdPath,
    log_id: LogIdPath,
    payload: SeizureLogUpdate,
    session: SessionDep,
    _: PatientAccessDep,
) -> SeizureLogRead:
    return await logs_service.update_log(
        session,
        SeizureLog,
        SeizureLogRead,
        patient_id=patient_id,
        log_id=log_id,
        payload=payload,
    )


@router.delete("/seizures/{log_id}", status_code=204, summary="Удалить запись о приступе")
async def delete_seizure_log(
    patient_id: PatientIdPath, log_id: LogIdPath, session: SessionDep, _: PatientAccessDep
) -> Response:
    await logs_service.delete_log(session, SeizureLog, patient_id=patient_id, log_id=log_id)
    return Response(status_code=204)


# --- кетоны ---------------------------------------------------------------


@router.get("/ketones", response_model=Page[KetoneLogRead], summary="Дневник кетонов")
async def list_ketone_logs(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    period: PeriodDep,
    page: PaginationDep,
) -> Page[KetoneLogRead]:
    return await logs_service.list_logs(
        session, KetoneLog, KetoneLogRead, patient_id=patient_id, period=period, page=page
    )


@router.post("/ketones", response_model=KetoneLogRead, status_code=201, summary="Записать кетоны")
async def create_ketone_log(
    patient_id: PatientIdPath,
    payload: KetoneLogCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> KetoneLogRead:
    return await logs_service.create_log(
        session, KetoneLog, KetoneLogRead, patient_id=patient_id, payload=payload, author=user
    )


@router.patch(
    "/ketones/{log_id}", response_model=KetoneLogRead, summary="Изменить запись о кетонах"
)
async def update_ketone_log(
    patient_id: PatientIdPath,
    log_id: LogIdPath,
    payload: KetoneLogUpdate,
    session: SessionDep,
    _: PatientAccessDep,
) -> KetoneLogRead:
    return await logs_service.update_log(
        session, KetoneLog, KetoneLogRead, patient_id=patient_id, log_id=log_id, payload=payload
    )


@router.delete("/ketones/{log_id}", status_code=204, summary="Удалить запись о кетонах")
async def delete_ketone_log(
    patient_id: PatientIdPath, log_id: LogIdPath, session: SessionDep, _: PatientAccessDep
) -> Response:
    await logs_service.delete_log(session, KetoneLog, patient_id=patient_id, log_id=log_id)
    return Response(status_code=204)


# --- вес ------------------------------------------------------------------


@router.get("/weight", response_model=Page[WeightLogRead], summary="Дневник веса")
async def list_weight_logs(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    period: PeriodDep,
    page: PaginationDep,
) -> Page[WeightLogRead]:
    return await logs_service.list_logs(
        session, WeightLog, WeightLogRead, patient_id=patient_id, period=period, page=page
    )


@router.post("/weight", response_model=WeightLogRead, status_code=201, summary="Записать вес")
async def create_weight_log(
    patient_id: PatientIdPath,
    payload: WeightLogCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> WeightLogRead:
    return await logs_service.create_log(
        session, WeightLog, WeightLogRead, patient_id=patient_id, payload=payload, author=user
    )


@router.patch("/weight/{log_id}", response_model=WeightLogRead, summary="Изменить запись о весе")
async def update_weight_log(
    patient_id: PatientIdPath,
    log_id: LogIdPath,
    payload: WeightLogUpdate,
    session: SessionDep,
    _: PatientAccessDep,
) -> WeightLogRead:
    return await logs_service.update_log(
        session, WeightLog, WeightLogRead, patient_id=patient_id, log_id=log_id, payload=payload
    )


@router.delete("/weight/{log_id}", status_code=204, summary="Удалить запись о весе")
async def delete_weight_log(
    patient_id: PatientIdPath, log_id: LogIdPath, session: SessionDep, _: PatientAccessDep
) -> Response:
    await logs_service.delete_log(session, WeightLog, patient_id=patient_id, log_id=log_id)
    return Response(status_code=204)


# --- лекарства ------------------------------------------------------------


@router.get("/medications", response_model=Page[MedicationLogRead], summary="Дневник лекарств")
async def list_medication_logs(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    period: PeriodDep,
    page: PaginationDep,
) -> Page[MedicationLogRead]:
    return await logs_service.list_logs(
        session, MedicationLog, MedicationLogRead, patient_id=patient_id, period=period, page=page
    )


@router.post(
    "/medications",
    response_model=MedicationLogRead,
    status_code=201,
    summary="Отметить приём препарата",
)
async def create_medication_log(
    patient_id: PatientIdPath,
    payload: MedicationLogCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> MedicationLogRead:
    return await logs_service.create_log(
        session,
        MedicationLog,
        MedicationLogRead,
        patient_id=patient_id,
        payload=payload,
        author=user,
    )


@router.patch(
    "/medications/{log_id}",
    response_model=MedicationLogRead,
    summary="Изменить отметку о приёме препарата",
)
async def update_medication_log(
    patient_id: PatientIdPath,
    log_id: LogIdPath,
    payload: MedicationLogUpdate,
    session: SessionDep,
    _: PatientAccessDep,
) -> MedicationLogRead:
    return await logs_service.update_log(
        session,
        MedicationLog,
        MedicationLogRead,
        patient_id=patient_id,
        log_id=log_id,
        payload=payload,
    )


@router.delete(
    "/medications/{log_id}", status_code=204, summary="Удалить отметку о приёме препарата"
)
async def delete_medication_log(
    patient_id: PatientIdPath, log_id: LogIdPath, session: SessionDep, _: PatientAccessDep
) -> Response:
    await logs_service.delete_log(session, MedicationLog, patient_id=patient_id, log_id=log_id)
    return Response(status_code=204)


# --- еда ------------------------------------------------------------------


@router.get("/meals", response_model=Page[MealLogRead], summary="Дневник питания")
async def list_meal_logs(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    period: PeriodDep,
    page: PaginationDep,
) -> Page[MealLogRead]:
    return await logs_service.list_logs(
        session, MealLog, MealLogRead, patient_id=patient_id, period=period, page=page
    )


@router.post("/meals", response_model=MealLogRead, status_code=201, summary="Записать приём пищи")
async def create_meal_log(
    patient_id: PatientIdPath,
    payload: MealLogCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> MealLogRead:
    return await logs_service.create_log(
        session, MealLog, MealLogRead, patient_id=patient_id, payload=payload, author=user
    )


@router.patch("/meals/{log_id}", response_model=MealLogRead, summary="Изменить запись о еде")
async def update_meal_log(
    patient_id: PatientIdPath,
    log_id: LogIdPath,
    payload: MealLogUpdate,
    session: SessionDep,
    _: PatientAccessDep,
) -> MealLogRead:
    return await logs_service.update_log(
        session, MealLog, MealLogRead, patient_id=patient_id, log_id=log_id, payload=payload
    )


@router.delete("/meals/{log_id}", status_code=204, summary="Удалить запись о еде")
async def delete_meal_log(
    patient_id: PatientIdPath, log_id: LogIdPath, session: SessionDep, _: PatientAccessDep
) -> Response:
    await logs_service.delete_log(session, MealLog, patient_id=patient_id, log_id=log_id)
    return Response(status_code=204)


# --- самочувствие ---------------------------------------------------------


@router.get("/side-effects", response_model=Page[SideEffectLogRead], summary="Дневник самочувствия")
async def list_side_effect_logs(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    period: PeriodDep,
    page: PaginationDep,
) -> Page[SideEffectLogRead]:
    return await logs_service.list_logs(
        session, SideEffectLog, SideEffectLogRead, patient_id=patient_id, period=period, page=page
    )


@router.post(
    "/side-effects",
    response_model=SideEffectLogRead,
    status_code=201,
    summary="Записать самочувствие",
)
async def create_side_effect_log(
    patient_id: PatientIdPath,
    payload: SideEffectLogCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> SideEffectLogRead:
    return await logs_service.create_log(
        session,
        SideEffectLog,
        SideEffectLogRead,
        patient_id=patient_id,
        payload=payload,
        author=user,
    )


@router.patch(
    "/side-effects/{log_id}",
    response_model=SideEffectLogRead,
    summary="Изменить запись о самочувствии",
)
async def update_side_effect_log(
    patient_id: PatientIdPath,
    log_id: LogIdPath,
    payload: SideEffectLogUpdate,
    session: SessionDep,
    _: PatientAccessDep,
) -> SideEffectLogRead:
    return await logs_service.update_log(
        session,
        SideEffectLog,
        SideEffectLogRead,
        patient_id=patient_id,
        log_id=log_id,
        payload=payload,
    )


@router.delete("/side-effects/{log_id}", status_code=204, summary="Удалить запись о самочувствии")
async def delete_side_effect_log(
    patient_id: PatientIdPath, log_id: LogIdPath, session: SessionDep, _: PatientAccessDep
) -> Response:
    await logs_service.delete_log(session, SideEffectLog, patient_id=patient_id, log_id=log_id)
    return Response(status_code=204)
