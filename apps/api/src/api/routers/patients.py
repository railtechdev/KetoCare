"""`/patients` — профиль пациента (раздел 5.3 ТЗ)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response

from core import exclusions
from core.models import Patient
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo
from core.repositories import users as users_repo

from ..client_address import client_address
from ..deps.auth import (
    AccessiblePatientsDep,
    CurrentUserDep,
    PatientAccessDep,
    SessionDep,
    require_roles,
)
from ..errors import ApiError, ErrorCode
from ..schemas import (
    ColleagueRead,
    ExcludedProductRef,
    FamilyMemberRead,
    Page,
    PatientCreate,
    PatientDoctorAdd,
    PatientRead,
    PatientUpdate,
)

CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)

router = APIRouter(prefix="/patients", tags=["patients"])


async def _read(session: SessionDep, patient: Patient) -> PatientRead:
    """Карточка ребёнка с разобранным полем исключений.

    Поле `allergies` хранит идентификаторы продуктов вперемешку со свободными
    метками (раздел 4.2 ТЗ). Хранение остаётся прежним, но наружу оно уходит
    разобранным: показывать «3f2a…» вместо «Арахисовое масло» — то же, что не
    показывать ничего, а список исключённого читают, решая, чем кормить.
    """

    return (await _read_many(session, [patient]))[0]


async def _read_many(session: SessionDep, patients: Sequence[Patient]) -> list[PatientRead]:
    """То же для списка — одним запросом к каталогу на всех детей сразу."""

    wanted: set[uuid.UUID] = set()
    for patient in patients:
        wanted |= exclusions.excluded_ids(patient.allergies)

    products = await products_repo.get_by_ids(session, product_ids=list(wanted))

    result: list[PatientRead] = []
    for patient in patients:
        ids, labels = exclusions.parse(patient.allergies)
        result.append(
            PatientRead.model_validate(patient).model_copy(
                update={
                    "excluded_products": [
                        ExcludedProductRef(
                            id=pid,
                            name_ru=products[pid].name_ru if pid in products else None,
                        )
                        # Порядок исходного поля: его задавал тот, кто заполнял.
                        for pid in [
                            uuid.UUID(entry)
                            for entry in patient.allergies
                            if _looks_like_uuid(entry)
                        ]
                        if pid in ids
                    ],
                    "allergy_labels": labels,
                }
            )
        )
    return result


def _looks_like_uuid(value: str) -> bool:
    try:
        uuid.UUID(value.strip())
    except ValueError:
        return False
    return True


@router.get("", response_model=Page[PatientRead], summary="Доступные пациенты")
async def list_patients(
    patient_ids: AccessiblePatientsDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PatientRead]:
    """Область видимости целиком определяется зависимостью `accessible_patient_ids`
    (связи пользователя + сужение по patient_scope), а не логикой этой ручки."""

    items, total = await patients_repo.list_for_ids(
        session, patient_ids=patient_ids, limit=limit, offset=offset
    )
    return Page(items=await _read_many(session, items), total=total)


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

    # Ведущий специалист — тот, кто пригласил эту семью (ADR-0003). Врач не может
    # «взять» пациента сам: он не проходит require_patient_access, пока не связан.
    # Поэтому связь возникает из происхождения учётной записи родителя, а не из
    # захвата, и появляется ровно у того, кто выдал приглашение лично.
    await _link_inviting_specialist(session, parent_id=user.id, patient_id=patient.id)

    return await _read(session, patient)


async def _link_inviting_specialist(
    session: SessionDep, *, parent_id: uuid.UUID, patient_id: uuid.UUID
) -> None:
    parent = await users_repo.get(session, parent_id)
    if parent is None or parent.invited_by is None:
        return

    inviter = await users_repo.get(session, parent.invited_by)
    if inviter is None or inviter.role not in CARE_ROLES or not inviter.is_active:
        return

    await patients_repo.link_doctor(session, doctor_id=inviter.id, patient_id=patient_id)


@router.get("/{patient_id}", response_model=PatientRead, summary="Профиль пациента")
async def get_patient(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> PatientRead:
    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")
    return await _read(session, patient)


@router.patch("/{patient_id}", response_model=PatientRead, summary="Изменить профиль ребёнка")
async def update_patient(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: PatientUpdate,
    request: Request,
    user: PatientAccessDep,
    session: SessionDep,
) -> PatientRead:
    """Меняют и семья, и ведущий специалист: рост ребёнок набирает между приёмами,
    а аллергию замечают дома раньше, чем в кабинете.

    Пишется аудит: рост и аллергии — основание для назначения и для состава меню,
    и «кто и когда изменил» здесь такой же клинический вопрос, как в назначениях.
    """

    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")

    before = PatientRead.model_validate(patient).model_dump(mode="json")
    updated = await patients_repo.update(session, patient=patient, **payload.model_dump())
    after = PatientRead.model_validate(updated).model_dump(mode="json")

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="patients",
        entity_id=patient_id,
        before=before,
        after=after,
        ip=client_address(request),
    )
    return await _read(session, updated)


@router.get(
    "/{patient_id}/doctors",
    response_model=list[ColleagueRead],
    summary="Специалисты, ведущие пациента",
)
async def list_patient_doctors(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> list[ColleagueRead]:
    """Видит и семья: родитель вправе знать, кто имеет доступ к данным ребёнка."""

    doctor_ids = await patients_repo.list_doctor_ids(session, patient_id=patient_id)
    doctors = [await users_repo.get(session, did) for did in doctor_ids]
    return [ColleagueRead.model_validate(d) for d in doctors if d is not None]


@router.get(
    "/{patient_id}/parents",
    response_model=list[FamilyMemberRead],
    summary="Кто ведёт ребёнка дома",
)
async def list_patient_parents(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> list[FamilyMemberRead]:
    """Зеркало `/doctors`, но с контактами.

    Флаг «семья молчит N дней» существует, чтобы вызвать действие, а
    единственное осмысленное действие — связаться с семьёй — интерфейсом не
    поддерживалось: контактов родителя в продукте не было нигде.

    Видит и семья: там же, где родитель узнаёт, кто из специалистов имеет
    доступ к данным ребёнка, он видит и второго родителя.
    """

    parent_ids = await patients_repo.list_parent_ids(session, patient_id=patient_id)
    parents = [await users_repo.get(session, pid) for pid in parent_ids]
    return [FamilyMemberRead.model_validate(p) for p in parents if p is not None]


@router.post(
    "/{patient_id}/doctors",
    response_model=list[ColleagueRead],
    status_code=201,
    summary="Передать пациента коллеге",
    dependencies=[Depends(require_roles(*CARE_ROLES))],
)
async def add_patient_doctor(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: PatientDoctorAdd,
    request: Request,
    user: PatientAccessDep,
    session: SessionDep,
) -> list[ColleagueRead]:
    """Добавляет коллегу к ведению.

    Звать может только тот, кто уже ведёт пациента (`PatientAccessDep`): иначе
    ручка стала бы способом получить доступ к любым клиническим данным, минуя
    разграничение (правило 5 CLAUDE.md).
    """

    colleague = await users_repo.get(session, payload.doctor_id)
    if colleague is None or not colleague.is_active or colleague.role not in CARE_ROLES:
        raise ApiError(ErrorCode.NOT_FOUND, "Специалист не найден.")

    await patients_repo.link_doctor(session, doctor_id=colleague.id, patient_id=patient_id)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="grant_patient_access",
        entity="doctor_patient",
        entity_id=patient_id,
        after={"doctor_id": str(colleague.id), "role": colleague.role.value},
        ip=client_address(request),
    )

    return await list_patient_doctors(patient_id, session, user)


@router.delete(
    "/{patient_id}/doctors/{doctor_id}",
    status_code=204,
    summary="Снять ведение пациента",
    dependencies=[Depends(require_roles(*CARE_ROLES))],
)
async def remove_patient_doctor(
    patient_id: Annotated[uuid.UUID, Path()],
    doctor_id: Annotated[uuid.UUID, Path()],
    request: Request,
    user: PatientAccessDep,
    session: SessionDep,
) -> Response:
    """Снимает доступ, но не трогает клинические данные — записи остаются.

    Последнего специалиста снять нельзя: ручки «взять пациента» намеренно нет
    (ADR-0003), поэтому пациент без ведущего остался бы без него навсегда.
    Сначала добавляется замена.
    """

    doctor_ids = await patients_repo.list_doctor_ids(session, patient_id=patient_id)
    if doctor_id not in doctor_ids:
        raise ApiError(ErrorCode.NOT_FOUND, "Этот специалист не ведёт пациента.")

    if len(doctor_ids) == 1:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Нельзя снять последнего специалиста: сначала добавьте того, кто примет пациента.",
        )

    await patients_repo.unlink_doctor(session, doctor_id=doctor_id, patient_id=patient_id)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="revoke_patient_access",
        entity="doctor_patient",
        entity_id=patient_id,
        before={"doctor_id": str(doctor_id)},
        ip=client_address(request),
    )
    return Response(status_code=204)
