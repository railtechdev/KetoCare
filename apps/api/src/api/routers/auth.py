"""`/auth` — вход, refresh, 2FA (раздел 5.2-5.3 ТЗ).

2FA обязательна для admin/doctor/dietitian, для родителя — опциональна.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import invitations as invitations_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import (
    InvitationAccept,
    InvitationCreate,
    InvitationCreated,
    LoginRequest,
    TokenPair,
    TotpSetupResponse,
    UserRead,
)
from ..security import (
    create_token,
    decode_token,
    generate_totp_secret,
    hash_password,
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


@router.post(
    "/invitations",
    response_model=InvitationCreated,
    status_code=201,
    summary="Пригласить пользователя",
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
async def create_invitation(
    payload: InvitationCreate, user: CurrentUserDep, session: SessionDep
) -> InvitationCreated:
    existing = await users_repo.get_by_email(session, payload.email)
    if existing is not None:
        raise ApiError(ErrorCode.CONFLICT, "Пользователь с таким email уже существует.")

    token = invitations_repo.generate_token()
    invitation = await invitations_repo.create(
        session, email=payload.email, role=payload.role, token=token
    )

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="invite",
        entity="invitations",
        entity_id=invitation.id,
        after={"email": payload.email, "role": payload.role.value},
    )

    return InvitationCreated(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        token=token,
        expires_at=invitation.expires_at,
    )


@router.post(
    "/invitations/accept",
    response_model=UserRead,
    status_code=201,
    summary="Принять приглашение и создать учётную запись",
)
async def accept_invitation(payload: InvitationAccept, session: SessionDep) -> UserRead:
    invitation = await invitations_repo.get_valid_by_token(session, payload.token)
    if invitation is None:
        # Не разделяем "нет такого токена" / "истёк" / "уже принят" — иначе токены
        # можно перебирать, определяя, какие из них существуют.
        raise ApiError(ErrorCode.NOT_FOUND, "Приглашение недействительно или истекло.")

    if await users_repo.get_by_email(session, invitation.email) is not None:
        raise ApiError(ErrorCode.CONFLICT, "Пользователь с таким email уже существует.")

    user = await users_repo.create(
        session,
        role=invitation.role,
        full_name=payload.full_name,
        email=invitation.email,
        password_hash=hash_password(payload.password),
        phone=payload.phone,
    )
    await invitations_repo.mark_accepted(session, invitation=invitation)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="accept_invitation",
        entity="users",
        entity_id=user.id,
        after={"email": user.email, "role": user.role.value},
    )
    return UserRead.model_validate(user)
