"""`/users` — справочник персонала (ADR-0003).

Нужен для передачи пациента коллеге: чтобы указать врача, его надо выбрать.
Клинических данных здесь нет — идентификатор, имя и роль активных специалистов.
Видят справочник только doctor и dietitian: родителю он не нужен, а
администратор пациентами не распоряжается (раздел 5.1 ТЗ).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import users as users_repo

from ..client_address import client_address
from ..cookies import set_auth_cookies
from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import AUTH_RATE_LIMIT, limiter
from ..schemas import ColleagueRead, MeUpdate, PasswordChange, TokenPair, UserRead
from ..security import create_token, hash_password_async, verify_password

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


@router.post("/me/password", response_model=TokenPair, summary="Сменить свой пароль")
@limiter.limit(AUTH_RATE_LIMIT)
async def change_password(
    payload: PasswordChange,
    request: Request,
    response: Response,
    user: CurrentUserDep,
    session: SessionDep,
) -> TokenPair:
    """Меняет пароль и обрывает все прежние сессии (раздел 11 ТЗ).

    Отзыв работает через отметку `password_changed_at`: она попадает в claim
    новых токенов, а любой токен с меньшей отметкой отвергается при следующей
    же проверке. Хранилища выданных токенов для этого не нужно.

    Вызвавшему сразу выдаётся новая пара — иначе смена пароля выкидывала бы из
    приложения того, кто её сделал.
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    if not verify_password(me.password_hash, payload.current_password):
        await audit_repo.write_audit_log_independent(
            user_id=me.id,
            action="password_change_failed",
            entity="users",
            entity_id=me.id,
            ip=client_address(request),
        )
        raise ApiError(ErrorCode.UNAUTHORIZED, "Текущий пароль указан неверно.")

    if payload.new_password == payload.current_password:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Новый пароль совпадает с текущим.")

    me.password_hash = await hash_password_async(payload.new_password)
    me.password_changed_at = datetime.now(UTC)
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=me.id,
        action="password_changed",
        entity="users",
        entity_id=me.id,
        ip=client_address(request),
    )

    tokens = TokenPair(
        access_token=create_token(
            user_id=me.id,
            role=me.role,
            token_type="access",
            password_changed_at=me.password_changed_at,
        ),
        refresh_token=create_token(
            user_id=me.id,
            role=me.role,
            token_type="refresh",
            password_changed_at=me.password_changed_at,
        ),
    )
    set_auth_cookies(response, tokens)
    return tokens
