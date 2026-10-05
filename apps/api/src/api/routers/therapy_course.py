"""Ход терапии: завершение и контрольные визиты (вопросы 17, 18 и 34; ADR-0050).

Права — как у медицинского профиля (ADR-0031): ставит и меняет врач, читает ещё
диетолог. Семья графика здесь не читает — о визите она узнаёт напоминанием в
боте, а о завершении терапии — нейтральной строкой в сводке.

Каждое изменение пишется в `audit_log`: завершение решает, кого система
перестаёт сопровождать, а визиты — часть клинической истории наблюдения.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path, Request, Response

from core.config import get_settings
from core.control_schedule import PERIODIC_LABS, WEEKLY_LABS, schedule_from
from core.models import ControlVisit, MedicalProfile, WeightLog
from core.models.enums import Sex, UserRole
from core.repositories import audit as audit_repo
from core.repositories import control_visits as visits_repo
from core.repositories import diary as diary_repo
from core.repositories import medical_profiles as profiles_repo
from core.repositories import patients as patients_repo
from core.repositories import therapy as therapy_repo

from ..client_address import client_address
from ..deps.auth import PatientAccessDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas_clinical import (
    ControlScheduleRead,
    ControlVisitCreate,
    ControlVisitRead,
    ControlVisitUpdate,
    MedicalProfileRead,
    TherapyEndWrite,
)
from ..schemas_growth import GrowthRead
from ..services import growth as growth_service
from ..services.clock import local_today
from ..services.control_visits import visit_read

router = APIRouter(prefix="/patients/{patient_id}", tags=["therapy"])

_DOCTOR_ONLY = Depends(require_roles(UserRole.DOCTOR))
_CARE_ROLES_READ = Depends(require_roles(UserRole.DOCTOR, UserRole.DIETITIAN))


# --- завершение терапии ------------------------------------------------------


@router.put(
    "/therapy-end",
    response_model=MedicalProfileRead,
    summary="Завершить кетодиетотерапию",
    dependencies=[_DOCTOR_ONLY],
)
async def put_therapy_end(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: TherapyEndWrite,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> MedicalProfileRead:
    """Ставит или поправляет завершение. Ребёнок уходит из рабочих списков врача,
    пометки о молчании семьи и напоминания прекращаются; карта и дневники
    остаются читаемыми (правило 4)."""

    if payload.ended_on > local_today():
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Дата завершения не может быть в будущем: завершение отмечается, когда оно "
            "состоялось. Плановую дату решения поставьте контрольным визитом.",
        )
    started = await therapy_repo.started_on(session, patient_id=patient_id)
    if started is not None and payload.ended_on < started:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Дата завершения раньше даты начала терапии — проверьте год.",
        )

    existing = await profiles_repo.get_for_patient(session, patient_id=patient_id)
    before = _end_snapshot(existing) if existing is not None else None
    profile = await profiles_repo.set_therapy_end(
        session,
        patient_id=patient_id,
        ended_on=payload.ended_on,
        reason=payload.reason,
        note=payload.note,
    )
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="therapy_ended",
        entity="medical_profiles",
        entity_id=profile.id,
        before=before,
        after=_end_snapshot(profile),
        ip=client_address(request),
    )
    return MedicalProfileRead.model_validate(profile)


@router.delete(
    "/therapy-end",
    status_code=204,
    summary="Снять отметку о завершении терапии",
    dependencies=[_DOCTOR_ONLY],
)
async def delete_therapy_end(
    patient_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> Response:
    """Терапия возобновлена или завершение отмечено по ошибке. Прежняя дата и
    причина остаются в журнале аудита."""

    existing = await profiles_repo.get_for_patient(session, patient_id=patient_id)
    if existing is None or existing.therapy_ended_on is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Терапия не отмечена завершённой.")
    before = _end_snapshot(existing)
    profile = await profiles_repo.set_therapy_end(
        session, patient_id=patient_id, ended_on=None, reason=None, note=None
    )
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="therapy_resumed",
        entity="medical_profiles",
        entity_id=profile.id,
        before=before,
        after=_end_snapshot(profile),
        ip=client_address(request),
    )
    return Response(status_code=204)


def _end_snapshot(profile: MedicalProfile) -> dict[str, Any]:
    ended_on = profile.therapy_ended_on
    reason = profile.therapy_end_reason
    return {
        "therapy_ended_on": ended_on.isoformat() if ended_on is not None else None,
        "therapy_end_reason": str(reason) if reason is not None else None,
        "therapy_end_note": profile.therapy_end_note,
    }


# --- рост и вес по нормам ВОЗ (вопрос 15) ----------------------------------------


@router.get(
    "/growth",
    response_model=GrowthRead,
    summary="Рост и вес относительно нормы ВОЗ: z-балл и перцентиль",
    dependencies=[_CARE_ROLES_READ],
)
async def get_growth(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> GrowthRead:
    """Ряд взвешиваний с оценкой по ВОЗ и сравнение с исходным значением.

    Врачу и диетологу: оценка — интерпретация, а не измерение, и семье её
    показывает врач (ответ клиники: «врачу показать оба»).
    """

    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")
    logs, _total = await diary_repo.list_for_patient(
        session, WeightLog, patient_id=patient_id, limit=GROWTH_POINTS_LIMIT
    )
    tz = ZoneInfo(get_settings().tz)
    return growth_service.assess(
        sex="m" if patient.sex is Sex.M else "f",
        birth_date=patient.birth_date,
        therapy_started_on=await therapy_repo.started_on(session, patient_id=patient_id),
        measurements=[
            growth_service.Measurement(
                measured_on=log.occurred_at.astimezone(tz).date(),
                weight_kg=float(log.weight_kg),
                height_cm=float(log.height_cm) if log.height_cm is not None else None,
            )
            for log in logs
        ],
    )


#: Сколько последних взвешиваний оценивать. Взвешивание раз в неделю — это
#: десять лет наблюдения; длиннее ряд экран не покажет.
GROWTH_POINTS_LIMIT = 500


# --- контрольные визиты ------------------------------------------------------


@router.get(
    "/control-schedule",
    response_model=ControlScheduleRead,
    summary="График контроля: визиты и анализы",
    dependencies=[_CARE_ROLES_READ],
)
async def get_control_schedule(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> ControlScheduleRead:
    today = local_today()
    visits = await visits_repo.list_for_patient(session, patient_id=patient_id)
    return ControlScheduleRead(
        visits=[visit_read(visit, today=today) for visit in visits],
        therapy_started_on=await therapy_repo.started_on(session, patient_id=patient_id),
        weekly_labs=list(WEEKLY_LABS),
        periodic_labs=list(PERIODIC_LABS),
    )


@router.post(
    "/control-visits/schedule",
    response_model=list[ControlVisitRead],
    status_code=201,
    summary="Построить график визитов от даты начала терапии",
    dependencies=[_DOCTOR_ONLY],
)
async def build_control_schedule(
    patient_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> list[ControlVisitRead]:
    """Визиты через 1, 3, 6, 9, 12 месяцев (вопрос 17) и точка решения о
    продолжении через 24 месяца (вопрос 18). Повторный вызов добавляет только
    недостающие точки и правок врача не трогает. Отвечает добавленными."""

    start = await therapy_repo.started_on(session, patient_id=patient_id)
    if start is None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Не задана дата начала терапии: укажите её в медицинском профиле "
            "или запишите назначение.",
        )
    created = await visits_repo.add_schedule(
        session, patient_id=patient_id, points=schedule_from(start), created_by=user.id
    )
    today = local_today()
    for visit in created:
        await _audit_visit(request, session, user.id, "create", visit, before=None)
    return [visit_read(visit, today=today) for visit in created]


@router.post(
    "/control-visits",
    response_model=ControlVisitRead,
    status_code=201,
    summary="Назначить контрольный визит вне графика",
    dependencies=[_DOCTOR_ONLY],
)
async def create_control_visit(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: ControlVisitCreate,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> ControlVisitRead:
    visit = await visits_repo.create(
        session,
        patient_id=patient_id,
        planned_on=payload.planned_on,
        note=payload.note,
        created_by=user.id,
    )
    await _audit_visit(request, session, user.id, "create", visit, before=None)
    return visit_read(visit, today=local_today())


@router.patch(
    "/control-visits/{visit_id}",
    response_model=ControlVisitRead,
    summary="Перенести визит или отметить его состоявшимся",
    dependencies=[_DOCTOR_ONLY],
)
async def update_control_visit(
    patient_id: Annotated[uuid.UUID, Path()],
    visit_id: Annotated[uuid.UUID, Path()],
    payload: ControlVisitUpdate,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> ControlVisitRead:
    visit = await _owned_visit(session, patient_id=patient_id, visit_id=visit_id)
    fields = payload.model_dump(exclude_unset=True)
    if fields.get("completed_on") is not None and fields["completed_on"] > local_today():
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, "Визит нельзя отметить состоявшимся будущей датой."
        )
    before = _visit_snapshot(visit)
    visit = await visits_repo.update(session, visit=visit, fields=fields)
    await _audit_visit(request, session, user.id, "update", visit, before=before)
    return visit_read(visit, today=local_today())


@router.delete(
    "/control-visits/{visit_id}",
    status_code=204,
    summary="Отменить контрольный визит",
    dependencies=[_DOCTOR_ONLY],
)
async def delete_control_visit(
    patient_id: Annotated[uuid.UUID, Path()],
    visit_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> Response:
    visit = await _owned_visit(session, patient_id=patient_id, visit_id=visit_id)
    before = _visit_snapshot(visit)
    await visits_repo.soft_delete(session, visit=visit)
    await _audit_visit(request, session, user.id, "delete", visit, before=before, deleted=True)
    return Response(status_code=204)


async def _owned_visit(
    session: SessionDep, *, patient_id: uuid.UUID, visit_id: uuid.UUID
) -> ControlVisit:
    visit = await visits_repo.get(session, patient_id=patient_id, visit_id=visit_id)
    if visit is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Визит не найден.")
    return visit


def _visit_snapshot(visit: ControlVisit) -> dict[str, Any]:
    return {
        "planned_on": visit.planned_on.isoformat(),
        "completed_on": visit.completed_on.isoformat() if visit.completed_on else None,
        "month_offset": visit.month_offset,
        "note": visit.note,
    }


async def _audit_visit(
    request: Request,
    session: SessionDep,
    user_id: uuid.UUID,
    action: str,
    visit: ControlVisit,
    *,
    before: dict[str, Any] | None,
    deleted: bool = False,
) -> None:
    await audit_repo.write_audit_log(
        session,
        user_id=user_id,
        action=action,
        entity="control_visits",
        entity_id=visit.id,
        before=before,
        after=None if deleted else _visit_snapshot(visit),
        ip=client_address(request),
    )
