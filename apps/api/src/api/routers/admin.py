"""`/admin` — учётные записи, справочники, журнал аудита (раздел 5.3 ТЗ).

Клинических данных здесь нет и быть не может: админ к ним доступа не имеет
(раздел 5.1 ТЗ). Роль проверяется на уровне роутера, а не каждой ручки, — так
новая ручка не может оказаться открытой из-за забытой зависимости.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response

from core.models import KetoneMethodDict, SeizureType
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

from ..client_address import client_address
from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import AdminPasswordReset, Page, UserRead
from ..schemas_admin import (
    AdminUserRead,
    AdminUserUpdate,
    AuditLogRead,
    DictionaryEntryCreate,
    DictionaryEntryRead,
    DictionaryEntryUpdate,
)
from ..services import admin as admin_service

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)


# --- учётные записи -------------------------------------------------------


@router.get("/users", response_model=Page[AdminUserRead], summary="Список учётных записей")
async def list_users(
    session: SessionDep,
    page: PaginationDep,
    q: Annotated[str | None, Query(max_length=255, description="Поиск по имени и почте")] = None,
    role: UserRole | None = None,
) -> Page[AdminUserRead]:
    items, total = await users_repo.list_all(
        session, query=q, role=role, limit=page.limit, offset=page.offset
    )

    # Сколько пациентов останутся без ведущего, если эту учётку отключить.
    # Одним запросом на всю страницу: двести запросов ради счётчика — это не
    # счётчик.
    care_ids = [u.id for u in items if u.role in (UserRole.DOCTOR, UserRole.DIETITIAN)]
    sole = await patients_repo.count_sole_doctor_patients_by_doctor(session, doctor_ids=care_ids)

    return Page(
        items=[
            AdminUserRead.model_validate(u).model_copy(update={"sole_patients": sole.get(u.id, 0)})
            for u in items
        ],
        total=total,
    )


@router.patch("/users/{user_id}", response_model=UserRead, summary="Изменить учётную запись")
async def update_user(
    user_id: Annotated[uuid.UUID, Path()],
    payload: AdminUserUpdate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> UserRead:
    updated = await admin_service.update_user(
        session,
        actor=user,
        user_id=user_id,
        payload=payload,
        ip=client_address(request),
    )
    return UserRead.model_validate(updated)


@router.post(
    "/users/{user_id}/reset-totp",
    response_model=UserRead,
    summary="Сбросить второй фактор",
)
async def reset_user_totp(
    user_id: Annotated[uuid.UUID, Path()],
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> UserRead:
    """Последняя ступень восстановления доступа: телефон утерян, резервные коды
    израсходованы. При следующем входе учётная запись пройдёт настройку второго
    фактора заново — отключением 2FA сброс не является."""

    updated = await admin_service.reset_totp(
        session,
        actor=user,
        user_id=user_id,
        ip=client_address(request),
    )
    return UserRead.model_validate(updated)


@router.post(
    "/users/{user_id}/reset-password",
    response_model=AdminPasswordReset,
    summary="Выдать временный пароль",
)
async def reset_user_password(
    user_id: Annotated[uuid.UUID, Path()],
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> AdminPasswordReset:
    """Восстановление доступа для забывшего пароль.

    Временный пароль возвращается один раз — в базе только argon2-хэш. Вход по
    нему не выдаёт рабочей сессии: человек обязан задать свой пароль, потому что
    временный знает и администратор.
    """

    temporary = await admin_service.reset_password(
        session,
        actor=user,
        user_id=user_id,
        ip=client_address(request),
    )
    return AdminPasswordReset(temporary_password=temporary)


# --- журнал аудита --------------------------------------------------------


@router.get("/audit-log", response_model=Page[AuditLogRead], summary="Журнал аудита")
async def list_audit_log(
    session: SessionDep,
    page: PaginationDep,
    user_id: uuid.UUID | None = None,
    entity: Annotated[str | None, Query(max_length=128)] = None,
    entity_id: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=128)] = None,
    created_from: Annotated[datetime | None, Query(alias="from")] = None,
    created_to: Annotated[datetime | None, Query(alias="to")] = None,
) -> Page[AuditLogRead]:
    """Только чтение: журнал не правится и не удаляется — иначе он не доказательство.

    `entity_id` нужен для истории правок одной позиции: без него интерфейс тянул
    страницу журнала целиком и отбирал строки у себя, то есть история продукта
    обрывалась там, где кончалась страница.
    """

    if created_from is not None and created_to is not None and created_from > created_to:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Начало периода позже его окончания.",
        )

    items, total = await audit_repo.list_entries(
        session,
        user_id=user_id,
        entity=entity,
        entity_id=entity_id,
        action=action,
        created_from=created_from,
        created_to=created_to,
        limit=page.limit,
        offset=page.offset,
    )
    return Page(items=[admin_service.audit_entry_to_schema(e) for e in items], total=total)


# --- справочники ----------------------------------------------------------
#
# Раздел 4.2 ТЗ: `seizure_types` и `ketone_methods` "наполняются миграцией-сидом;
# правятся админом". Ручки разведены по путям, а не по параметру `{dictionary}`:
# так они попадают в OpenAPI и в сгенерированный клиент под собственными именами.
#
# Здесь только правка. Чтение — в `routers/dictionaries.py` и доступно всем
# аутентифицированным: без списка типов приступов семья не может записать
# приступ. Второй копии выборки не заводим — админка читает ту же ручку.


@router.post(
    "/dictionaries/seizure-types",
    response_model=DictionaryEntryRead,
    status_code=201,
    summary="Добавить тип приступа",
)
async def create_seizure_type(
    payload: DictionaryEntryCreate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> DictionaryEntryRead:
    return await admin_service.create_dictionary_entry(
        session, SeizureType, payload=payload, actor=user, ip=client_address(request)
    )


@router.patch(
    "/dictionaries/seizure-types/{entry_id}",
    response_model=DictionaryEntryRead,
    summary="Изменить тип приступа",
)
async def update_seizure_type(
    entry_id: Annotated[uuid.UUID, Path()],
    payload: DictionaryEntryUpdate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> DictionaryEntryRead:
    return await admin_service.update_dictionary_entry(
        session,
        SeizureType,
        entry_id=entry_id,
        payload=payload,
        actor=user,
        ip=client_address(request),
    )


@router.delete(
    "/dictionaries/seizure-types/{entry_id}",
    status_code=204,
    summary="Удалить тип приступа",
)
async def delete_seizure_type(
    entry_id: Annotated[uuid.UUID, Path()],
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> Response:
    await admin_service.delete_dictionary_entry(
        session, SeizureType, entry_id=entry_id, actor=user, ip=client_address(request)
    )
    return Response(status_code=204)


@router.post(
    "/dictionaries/ketone-methods",
    response_model=DictionaryEntryRead,
    status_code=201,
    summary="Добавить метод измерения кетонов",
)
async def create_ketone_method(
    payload: DictionaryEntryCreate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> DictionaryEntryRead:
    return await admin_service.create_dictionary_entry(
        session, KetoneMethodDict, payload=payload, actor=user, ip=client_address(request)
    )


@router.patch(
    "/dictionaries/ketone-methods/{entry_id}",
    response_model=DictionaryEntryRead,
    summary="Изменить метод измерения кетонов",
)
async def update_ketone_method(
    entry_id: Annotated[uuid.UUID, Path()],
    payload: DictionaryEntryUpdate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> DictionaryEntryRead:
    return await admin_service.update_dictionary_entry(
        session,
        KetoneMethodDict,
        entry_id=entry_id,
        payload=payload,
        actor=user,
        ip=client_address(request),
    )


@router.delete(
    "/dictionaries/ketone-methods/{entry_id}",
    status_code=204,
    summary="Удалить метод измерения кетонов",
)
async def delete_ketone_method(
    entry_id: Annotated[uuid.UUID, Path()],
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> Response:
    await admin_service.delete_dictionary_entry(
        session, KetoneMethodDict, entry_id=entry_id, actor=user, ip=client_address(request)
    )
    return Response(status_code=204)
