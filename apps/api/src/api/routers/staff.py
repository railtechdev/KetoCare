"""`/users` — справочник персонала (ADR-0003).

Нужен для передачи пациента коллеге: чтобы указать врача, его надо выбрать.
Клинических данных здесь нет — идентификатор, имя и роль активных специалистов.
Видят справочник только doctor и dietitian: родителю он не нужен, а
администратор пациентами не распоряжается (раздел 5.1 ТЗ).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from core.models.enums import UserRole
from core.repositories import users as users_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import ColleagueRead, MeUpdate, UserRead

router = APIRouter(prefix="/users", tags=["users"])

CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


@router.get(
    "/colleagues",
    response_model=list[ColleagueRead],
    summary="Врачи и диетологи клиники",
    dependencies=[Depends(require_roles(*CARE_ROLES))],
)
async def list_colleagues(session: SessionDep) -> list[ColleagueRead]:
    users = await users_repo.list_active_by_roles(session, roles=CARE_ROLES)
    return [ColleagueRead.model_validate(u) for u in users]


@router.get("/me", response_model=UserRead, summary="Свой профиль")
async def read_me(user: CurrentUserDep, session: SessionDep) -> UserRead:
    """Профиль текущего пользователя.

    Отдельная ручка нужна была с самого начала: имя пользователя не лежит в
    токене (там только идентификатор и роль), поэтому интерфейс не мог показать
    даже, под кем он работает. Менять своё имя и телефон было тоже нечем —
    это делал только администратор.
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")
    return UserRead.model_validate(me)


@router.patch("/me", response_model=UserRead, summary="Изменить свой профиль")
async def update_me(payload: MeUpdate, user: CurrentUserDep, session: SessionDep) -> UserRead:
    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    updated = await users_repo.update(session, user=me, **payload.model_dump())
    return UserRead.model_validate(updated)
