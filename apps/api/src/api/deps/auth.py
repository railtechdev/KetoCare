"""Зависимости аутентификации и RBAC (раздел 5.1-5.2 ТЗ).

Правило 5 (CLAUDE.md): разграничение доступа проверяется на сервере.
Любая ручка с данными пациента обязана использовать `require_patient_access`.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable, Coroutine
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.db import get_sessionmaker
from core.models.enums import UserRole
from core.repositories import access as access_repo
from core.repositories import users as users_repo

from ..errors import ApiError, ErrorCode
from ..security import decode_token


def client_ip(request: Request) -> str | None:
    """IP клиента для `audit_log.ip` (раздел 4.2 ТЗ).

    За обратным прокси реальный адрес приходит в X-Forwarded-For; берётся первый
    элемент — он ближе всего к клиенту. Заголовок подделывается клиентом, поэтому
    nginx обязан его перезаписывать (см. infra/nginx).
    """

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.client.host if request.client else None


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


SessionDep = Annotated[AsyncSession, Depends(get_session)]


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: uuid.UUID
    role: UserRole
    patient_scope: uuid.UUID | None = None


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token

    # Web использует httpOnly cookie, Mini App — заголовок (раздел 5.2 ТЗ)
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token

    raise ApiError(ErrorCode.UNAUTHORIZED, "Требуется вход в систему.")


async def get_current_user(request: Request, session: SessionDep) -> CurrentUser:
    payload = decode_token(_bearer_token(request), expected_type="access")

    try:
        user_id = uuid.UUID(payload["sub"])
        role = UserRole(payload["role"])
    except (KeyError, ValueError) as exc:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Недействительный токен.") from exc

    user = await users_repo.get(session, user_id)
    if user is None or not user.is_active:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись недоступна.")

    # Роль берётся из БД, а не из токена: понижение прав должно действовать сразу,
    # не дожидаясь истечения выданного access-токена.
    if user.role is not role:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Права учётной записи изменились, войдите заново.")

    scope_raw = payload.get("patient_scope")
    patient_scope = uuid.UUID(scope_raw) if scope_raw else None

    return CurrentUser(id=user.id, role=user.role, patient_scope=patient_scope)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(
    *roles: UserRole,
) -> Callable[[CurrentUser], Coroutine[Any, Any, CurrentUser]]:
    """Ограничение ручки по ролям (не заменяет `require_patient_access`)."""

    allowed = frozenset(roles)

    async def _dependency(user: CurrentUserDep) -> CurrentUser:
        if user.role not in allowed:
            raise ApiError(ErrorCode.FORBIDDEN, "Недостаточно прав для этого действия.")
        return user

    return _dependency


async def require_patient_access(
    patient_id: Annotated[uuid.UUID, Path()],
    user: CurrentUserDep,
    session: SessionDep,
) -> CurrentUser:
    """Проверяет связь текущего пользователя с пациентом (раздел 5.1 ТЗ).

    Админ к клиническим данным доступа не имеет — это обеспечивает
    `core.repositories.access`, возвращая False для роли admin.
    """

    # Токен Mini App ограничен конкретным пациентом — сузить его нельзя обойти
    if user.patient_scope is not None and user.patient_scope != patient_id:
        raise ApiError(ErrorCode.FORBIDDEN, "Нет доступа к данным этого пациента.")

    allowed = await access_repo.user_has_patient_access(
        session, user_id=user.id, role=user.role, patient_id=patient_id
    )
    if not allowed:
        raise ApiError(ErrorCode.FORBIDDEN, "Нет доступа к данным этого пациента.")

    return user


PatientAccessDep = Annotated[CurrentUser, Depends(require_patient_access)]


async def get_totp_setup_user(request: Request, session: SessionDep) -> CurrentUser:
    """Пользователь, которому разрешено настраивать 2FA.

    Принимает либо обычный access-токен (смена уже настроенного второго фактора),
    либо краткоживущий `totp_setup`-токен, выданный /auth/login тому, кому 2FA
    обязательна, но ещё не настроена. Этот токен не подходит ни к одной другой
    ручке: остальные зависимости требуют `expected_type="access"`.
    """

    token = _bearer_token(request)
    try:
        payload = decode_token(token, expected_type="access")
    except ApiError:
        payload = decode_token(token, expected_type="totp_setup")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Недействительный токен.") from exc

    user = await users_repo.get(session, user_id)
    if user is None or not user.is_active:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись недоступна.")

    return CurrentUser(id=user.id, role=user.role)


TotpSetupUserDep = Annotated[CurrentUser, Depends(get_totp_setup_user)]
