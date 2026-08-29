"""Клинические данные пациента: медицинский профиль, препараты, врачебные заметки.

Раздел 5.3 ТЗ (`/patients/{id}/medical-profile`, `/medications`) и раздел 4.2
(`clinical_notes`).

Доступ. `require_patient_access` отвечает только на вопрос «связан ли пользователь
с этим пациентом» и одинаков для врача и родителя, поэтому поверх него здесь стоит
проверка ролей: диагноз, генетика и заметки врача — данные для медперсонала, а не
для семьи (родитель видит назначение и препараты, но не врачебную интерпретацию).
Обе проверки возвращают 403, так что по коду ответа нельзя отличить «не твой
пациент» от «не твоя роль».
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query, Response

from core.models import Medication
from core.models.enums import IntakeScale, UserRole
from core.repositories import audit as audit_repo
from core.repositories import clinical_notes as notes_repo
from core.repositories import medical_profiles as profiles_repo
from core.repositories import medications as medications_repo

from ..deps.auth import PatientAccessDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import Page
from ..schemas_clinical import (
    ClinicalNoteCreate,
    ClinicalNoteRead,
    MedicalProfileRead,
    MedicalProfileWrite,
    MedicationRead,
    MedicationWrite,
)
from ..services import intake as intake_service

router = APIRouter(prefix="/patients/{patient_id}", tags=["clinical"])

# Раздел 5.3 ТЗ помечает и медицинский профиль, и схему терапии, и заметки
# как врачебные. Расширять роль до диетолога здесь не стали: доводы «диетологу
# нужен диагноз для подбора рациона» правдоподобны, но это решение о доступе к
# клиническим данным ребёнка, и принимать его за медицинскую команду нельзя.
# Вопрос вынесен в docs/medical/OPEN_QUESTIONS.md.
_DOCTOR_ONLY = Depends(require_roles(UserRole.DOCTOR))


# --- medical profile ------------------------------------------------------


@router.get(
    "/medical-profile",
    response_model=MedicalProfileRead,
    summary="Медицинский профиль пациента",
    dependencies=[_DOCTOR_ONLY],
)
async def get_medical_profile(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> MedicalProfileRead:
    profile = await profiles_repo.get_for_patient(session, patient_id=patient_id)
    if profile is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Медицинский профиль ещё не заполнен.")
    return MedicalProfileRead.model_validate(profile)


@router.put(
    "/medical-profile",
    response_model=MedicalProfileRead,
    summary="Заполнить или изменить медицинский профиль",
    dependencies=[_DOCTOR_ONLY],
)
async def put_medical_profile(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: MedicalProfileWrite,
    session: SessionDep,
    user: PatientAccessDep,
) -> MedicalProfileRead:
    """Одна запись на пациента (unique patient_id), поэтому PUT — upsert."""

    # Врачебная часть анкеты регистрации: вариант должен быть из своей шкалы,
    # иначе в «сколько ПЭП сменил» окажется «Раз в 2-3 недели» (ADR-0007).
    await intake_service.check_option_scale(
        session,
        option_id=payload.aed_switch_count_id,
        scale=IntakeScale.AED_SWITCH_COUNT,
        field="aed_switch_count_id",
    )

    existing = await profiles_repo.get_for_patient(session, patient_id=patient_id)
    before = (
        MedicalProfileRead.model_validate(existing).model_dump(mode="json") if existing else None
    )

    profile = await profiles_repo.upsert(
        session,
        patient_id=patient_id,
        diagnosis=payload.diagnosis,
        epilepsy_type=payload.epilepsy_type,
        onset_age_months=payload.onset_age_months,
        genetics=payload.genetics.model_dump() if payload.genetics is not None else None,
        comorbidities=payload.comorbidities,
        aed_switch_count_id=payload.aed_switch_count_id,
    )

    # Профиль перезаписывается на месте, истории версий у него нет (в отличие от
    # append-only назначений). Без записи в audit_log предыдущий диагноз исчезал бы
    # бесследно, а он — основание для всей диетотерапии.
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create" if existing is None else "update",
        entity="medical_profiles",
        entity_id=profile.id,
        before=before,
        after=MedicalProfileRead.model_validate(profile).model_dump(mode="json"),
    )
    return MedicalProfileRead.model_validate(profile)


# --- medications ----------------------------------------------------------


@router.get(
    "/medications",
    response_model=Page[MedicationRead],
    summary="Схема лекарственной терапии",
)
async def list_medications(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
    page: PaginationDep,
    active_on: Annotated[
        date | None, Query(description="Только препараты, принимаемые в этот день")
    ] = None,
) -> Page[MedicationRead]:
    """Единственная ручка группы без ограничения по роли: препараты ребёнку даёт
    родитель, а бот показывает ему «список активных препаратов на сегодня»
    (раздел 7.3 ТЗ) — без чтения этот сценарий неисполним. Изменять схему может
    только врач.
    """

    items, total = await medications_repo.list_for_patient(
        session, patient_id=patient_id, active_on=active_on, limit=page.limit, offset=page.offset
    )
    return Page(items=[MedicationRead.model_validate(m) for m in items], total=total)


@router.post(
    "/medications",
    response_model=MedicationRead,
    status_code=201,
    summary="Назначить препарат",
    dependencies=[_DOCTOR_ONLY],
)
async def create_medication(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: MedicationWrite,
    session: SessionDep,
    user: PatientAccessDep,
) -> MedicationRead:
    medication = await medications_repo.create(
        session,
        patient_id=patient_id,
        drug_name=payload.drug_name,
        dose=payload.dose,
        frequency=payload.frequency,
        started_at=payload.started_at,
        stopped_at=payload.stopped_at,
        author_id=user.id,
    )
    await _audit_medication(session, user_id=user.id, action="create", medication=medication)
    return MedicationRead.model_validate(medication)


async def _owned_medication(
    session: SessionDep, medication_id: uuid.UUID, patient_id: uuid.UUID
) -> Medication:
    """Запись, принадлежащая именно этому пациенту.

    Доступ к пациенту не означает права на запись другого пациента. Несовпадение
    отдаётся как 404, а не 403: иначе по коду ответа можно узнать, что такая
    запись существует у кого-то ещё.
    """

    medication = await medications_repo.get(session, medication_id)
    if medication is None or medication.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Препарат не найден.")
    return medication


@router.put(
    "/medications/{medication_id}",
    response_model=MedicationRead,
    summary="Изменить назначение препарата",
    dependencies=[_DOCTOR_ONLY],
)
async def update_medication(
    patient_id: Annotated[uuid.UUID, Path()],
    medication_id: Annotated[uuid.UUID, Path()],
    payload: MedicationWrite,
    session: SessionDep,
    user: PatientAccessDep,
) -> MedicationRead:
    """Отмена препарата — это `stopped_at`, а не удаление: запись остаётся
    видимой, потому что объясняет уже сделанные отметки о приёме."""

    medication = await _owned_medication(session, medication_id, patient_id)
    before = MedicationRead.model_validate(medication).model_dump(mode="json")

    updated = await medications_repo.update(
        session,
        medication=medication,
        drug_name=payload.drug_name,
        dose=payload.dose,
        frequency=payload.frequency,
        started_at=payload.started_at,
        stopped_at=payload.stopped_at,
    )
    await _audit_medication(
        session, user_id=user.id, action="update", medication=updated, before=before
    )
    return MedicationRead.model_validate(updated)


@router.delete(
    "/medications/{medication_id}",
    status_code=204,
    summary="Удалить ошибочную запись о препарате",
    dependencies=[_DOCTOR_ONLY],
)
async def delete_medication(
    patient_id: Annotated[uuid.UUID, Path()],
    medication_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: PatientAccessDep,
) -> Response:
    medication = await _owned_medication(session, medication_id, patient_id)
    before = MedicationRead.model_validate(medication).model_dump(mode="json")

    await medications_repo.soft_delete(session, medication=medication)
    await _audit_medication(
        session, user_id=user.id, action="delete", medication=medication, before=before
    )
    return Response(status_code=204)


async def _audit_medication(
    session: SessionDep,
    *,
    user_id: uuid.UUID,
    action: str,
    medication: Medication,
    before: dict[str, Any] | None = None,
) -> None:
    """Схема терапии — назначение врача (раздел 4.2 ТЗ: аудит обязателен для
    назначений), и, в отличие от `prescriptions`, она изменяемая: без before/after
    предыдущая доза не восстанавливается."""

    await audit_repo.write_audit_log(
        session,
        user_id=user_id,
        action=action,
        entity="medications",
        entity_id=medication.id,
        before=before,
        after=MedicationRead.model_validate(medication).model_dump(mode="json"),
    )


# --- clinical notes -------------------------------------------------------


@router.get(
    "/clinical-notes",
    response_model=Page[ClinicalNoteRead],
    summary="Врачебные заметки",
    dependencies=[_DOCTOR_ONLY],
)
async def list_clinical_notes(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
    page: PaginationDep,
) -> Page[ClinicalNoteRead]:
    items, total = await notes_repo.list_for_patient(
        session, patient_id=patient_id, limit=page.limit, offset=page.offset
    )
    return Page(items=[ClinicalNoteRead.model_validate(n) for n in items], total=total)


@router.post(
    "/clinical-notes",
    response_model=ClinicalNoteRead,
    status_code=201,
    summary="Добавить врачебную заметку",
    dependencies=[_DOCTOR_ONLY],
)
async def create_clinical_note(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: ClinicalNoteCreate,
    session: SessionDep,
    user: PatientAccessDep,
) -> ClinicalNoteRead:
    """Заметки только добавляются и читаются: ручек изменения и удаления нет
    намеренно (см. `core.repositories.clinical_notes`). Автор берётся из токена,
    а не из тела запроса — подписать заметку чужим именем нельзя.
    """

    note = await notes_repo.create(
        session, patient_id=patient_id, author_id=user.id, text=payload.text
    )
    return ClinicalNoteRead.model_validate(note)
