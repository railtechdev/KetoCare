"""Коды доступа семьи к ребёнку (ADR-0040).

Выдача живёт **внутри карты ребёнка** — `POST /patients/{id}/access-codes`, — а не
в `/auth`, по той же причине, по какой там живёт выпуск кода привязки Telegram:
`patient_id` приходит из пути, и ручка проходит через `require_patient_access`,
как любая другая ручка с данными пациента (правило 5). С `patient_id` в теле
проверку пришлось бы писать руками — то есть её можно было бы забыть, и
специалист выдал бы доступ к чужому ребёнку.

Активация лежит в двух других местах и оба раза не здесь: незнакомый системе
человек активирует код в `/auth` (сессии у него ещё нет), уже вошедший
родитель — в `/users/me` (ребёнок у него не выбран, `patient_id` взять неоткуда).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Request

from core.models.enums import AccessCodePurpose, UserRole

from ..client_address import client_address
from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas_access import AccessCodeCreated, AccessCodeIssue, AccessCodeRead
from ..services import access_codes as service

router = APIRouter(prefix="/patients/{patient_id}/access-codes", tags=["access-codes"])

PatientIdPath = Annotated[uuid.UUID, Path()]

#: Кто вправе выдать код. Родитель — с этапа Б: сначала только себе (замена
#: коду привязки Telegram), с ADR-0042 — и другому взрослому. Срок выбирает
#: `ttl_for(purpose)` в репозитории, а не эта ручка.
ISSUER_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT)


def _require_issuer(user: PatientAccessDep) -> None:
    """Код выдаёт ведущий специалист или сам родитель — и только из веб-кабинета.

    Роль проверяется здесь, а не зависимостью `require_roles`: администратор к
    клиническим данным доступа не имеет вовсе и до этой ручки не дойдёт.
    """

    if user.role not in ISSUER_ROLES:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Код доступа выдаёт лечащий врач, диетолог или родитель ребёнка.",
        )
    if user.channel != "web":
        # Сессии бота и Mini App сужены до одного ребёнка и живут 15 минут;
        # выпуск через них означал бы, что временный доступ к чату умеет
        # раздавать постоянный доступ к данным.
        raise ApiError(ErrorCode.FORBIDDEN, "Код доступа выдаётся только в веб-кабинете.")


def _purpose_for(user: PatientAccessDep, requested: AccessCodePurpose | None) -> AccessCodePurpose:
    """Назначение кода: запрошенное либо прежнее для роли (ADR-0042).

    Код «свой чат» выпускает только родитель: он подключает Telegram к учётной
    записи выдавшего, а у специалиста к ребёнку чата быть не может — бот
    принадлежит семье.
    """

    if requested is None:
        return (
            AccessCodePurpose.OWN_CHAT
            if user.role is UserRole.PARENT
            else AccessCodePurpose.FAMILY_MEMBER
        )
    if requested is AccessCodePurpose.OWN_CHAT and user.role is not UserRole.PARENT:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Код для своего чата выпускает только родитель. Чтобы открыть доступ семье, "
            "выпустите код для другого взрослого.",
        )
    return requested


@router.post("", response_model=AccessCodeCreated, status_code=201, summary="Выдать доступ семье")
async def issue_access_code(
    patient_id: PatientIdPath,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
    body: AccessCodeIssue | None = None,
) -> AccessCodeCreated:
    """Выпускает код, который семья активирует дома — в боте или в вебе."""

    _require_issuer(user)
    purpose = _purpose_for(user, body.purpose if body is not None else None)
    return await service.issue(
        session,
        patient_id=patient_id,
        issuer=user,
        purpose=purpose,
        ip=client_address(request),
    )


@router.get("", response_model=list[AccessCodeRead], summary="Журнал кодов доступа")
async def list_access_codes(
    patient_id: PatientIdPath,
    session: SessionDep,
    user: PatientAccessDep,
) -> list[AccessCodeRead]:
    """Все коды ребёнка, включая погашенные и отозванные.

    Пагинации нет намеренно: кодов у ребёнка единицы за всю терапию, а «показать
    ещё» в журнале из трёх строк — лишний механизм.
    """

    _require_issuer(user)
    return await service.journal(session, patient_id=patient_id, viewer_id=user.id)


@router.post("/{code}/revoke", status_code=204, summary="Отозвать код доступа")
async def revoke_access_code(
    patient_id: PatientIdPath,
    code: Annotated[str, Path(max_length=16)],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> None:
    _require_issuer(user)
    await service.revoke(
        session, patient_id=patient_id, code=code, actor=user, ip=client_address(request)
    )
