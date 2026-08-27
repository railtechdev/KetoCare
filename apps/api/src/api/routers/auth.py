"""`/auth` — вход, refresh, 2FA (раздел 5.2-5.3 ТЗ).

2FA обязательна для admin/doctor/dietitian, для родителя — опциональна.
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUserDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas import LoginRequest, TokenPair, TotpSetupResponse
from ..security import (
    create_token,
    decode_token,
    generate_totp_secret,
    totp_provisioning_uri,
    verify_password,
    verify_totp,
)

router = APIRouter(prefix="/auth", tags=["auth"])

ROLES_REQUIRING_TOTP = frozenset({UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN})

_INVALID_CREDENTIALS = "Неверный email или пароль."


def _set_auth_cookies(response: Response, tokens: TokenPair) -> None:
    """httpOnly cookie для web (раздел 11 ТЗ: httpOnly, secure, samesite=lax)."""

    response.set_cookie(
        "access_token", tokens.access_token, httponly=True, secure=True, samesite="lax"
    )
    response.set_cookie(
        "refresh_token", tokens.refresh_token, httponly=True, secure=True, samesite="lax"
    )


@router.post("/login", response_model=TokenPair, summary="Вход по паролю (+ TOTP)")
async def login(payload: LoginRequest, response: Response, session: SessionDep) -> TokenPair:
    user = await users_repo.get_by_email(session, payload.email)

    # Одинаковое сообщение для несуществующего пользователя и неверного пароля —
    # чтобы по ответу нельзя было перебирать существующие email.
    if user is None or not verify_password(user.password_hash, payload.password):
        raise ApiError(ErrorCode.UNAUTHORIZED, _INVALID_CREDENTIALS)

    if not user.is_active:
        raise ApiError(ErrorCode.FORBIDDEN, "Учётная запись отключена.")

    if user.role in ROLES_REQUIRING_TOTP or user.totp_secret:
        if not user.totp_secret:
            raise ApiError(
                ErrorCode.FORBIDDEN,
                "Для этой роли нужно настроить двухфакторную аутентификацию.",
            )
        if not payload.totp_code or not verify_totp(user.totp_secret, payload.totp_code):
            raise ApiError(ErrorCode.UNAUTHORIZED, "Неверный код подтверждения.")

    tokens = TokenPair(
        access_token=create_token(user_id=user.id, role=user.role, token_type="access"),
        refresh_token=create_token(user_id=user.id, role=user.role, token_type="refresh"),
    )
    _set_auth_cookies(response, tokens)

    await audit_repo.write_audit_log(
        session, user_id=user.id, action="login", entity="users", entity_id=user.id
    )
    return tokens


@router.post("/refresh", response_model=TokenPair, summary="Обновить пару токенов")
async def refresh(response: Response, session: SessionDep, refresh_token: str) -> TokenPair:
    payload = decode_token(refresh_token, expected_type="refresh")

    import uuid as _uuid

    user = await users_repo.get(session, _uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись недоступна.")

    tokens = TokenPair(
        access_token=create_token(user_id=user.id, role=user.role, token_type="access"),
        refresh_token=create_token(user_id=user.id, role=user.role, token_type="refresh"),
    )
    _set_auth_cookies(response, tokens)
    return tokens


@router.post("/logout", status_code=204, summary="Выход")
async def logout(response: Response) -> None:
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")


@router.post("/totp/setup", response_model=TotpSetupResponse, summary="Начать настройку 2FA")
async def totp_setup(user: CurrentUserDep, session: SessionDep) -> TotpSetupResponse:
    db_user = await users_repo.get(session, user.id)
    if db_user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    secret = generate_totp_secret()
    db_user.totp_secret = secret
    await session.flush()

    await audit_repo.write_audit_log(
        session, user_id=user.id, action="totp_setup", entity="users", entity_id=user.id
    )
    return TotpSetupResponse(
        secret=secret, provisioning_uri=totp_provisioning_uri(secret, email=db_user.email)
    )
