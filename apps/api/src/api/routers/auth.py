"""`/auth` — вход, refresh, 2FA (раздел 5.2-5.3 ТЗ).

2FA обязательна для admin/doctor/dietitian, для родителя — опциональна.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response

from core.models import User
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import invitations as invitations_repo
from core.repositories import users as users_repo

from ..client_address import client_address
from ..deps.auth import CurrentUserDep, SessionDep, TotpSetupUserDep, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import AUTH_RATE_LIMIT, REFRESH_RATE_LIMIT, limiter
from ..schemas import (
    InvitationAccept,
    InvitationCreate,
    InvitationCreated,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    TokenPair,
    TotpSetupRequest,
    TotpSetupResponse,
    TotpVerifyRequest,
    UserRead,
)
from ..security import (
    create_token,
    decode_token,
    generate_totp_secret,
    hash_password_async,
    totp_provisioning_uri,
    verify_password_async,
    verify_totp,
    waste_password_verification_async,
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


def _issue_tokens(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user_id=user.id, role=user.role, token_type="access"),
        refresh_token=create_token(user_id=user.id, role=user.role, token_type="refresh"),
    )


@router.post("/login", response_model=LoginResponse, summary="Вход по паролю (+ TOTP)")
@limiter.limit(AUTH_RATE_LIMIT)
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> LoginResponse:
    user = await users_repo.get_by_email(session, payload.email)

    # Один и тот же 401 и одно и то же время ответа для «нет такого email»,
    # «неверный пароль» и «учётная запись отключена»: иначе по ответу или по
    # задержке можно перебирать существующие учётные записи. Для отсутствующего
    # пользователя argon2 всё равно прогоняется вхолостую.
    if user is None:
        await waste_password_verification_async()
        raise ApiError(ErrorCode.UNAUTHORIZED, _INVALID_CREDENTIALS)

    password_ok = await verify_password_async(user.password_hash, payload.password)
    if not password_ok or not user.is_active:
        # Отдельная транзакция: запрос завершится исключением, и сессия ручки
        # будет откатана — обычная запись аудита пропала бы вместе с ней.
        await audit_repo.write_audit_log_independent(
            user_id=user.id,
            action="login_failed",
            entity="users",
            entity_id=user.id,
            ip=client_address(request),
        )
        raise ApiError(ErrorCode.UNAUTHORIZED, _INVALID_CREDENTIALS)

    needs_totp = user.role in ROLES_REQUIRING_TOTP or user.totp_secret is not None

    if needs_totp and user.totp_secret is None:
        # Приглашённому врачу/диетологу/админу 2FA обязательна, но настроить её
        # до первого входа негде. Пароль уже проверен, поэтому выдаём токен,
        # действующий только для /auth/totp/setup и /auth/totp/verify.
        return LoginResponse(
            status="totp_setup_required",
            totp_setup_token=create_token(user_id=user.id, role=user.role, token_type="totp_setup"),
        )

    if needs_totp:
        assert user.totp_secret is not None
        if not payload.totp_code or not verify_totp(user.totp_secret, payload.totp_code):
            await audit_repo.write_audit_log_independent(
                user_id=user.id,
                action="login_failed_totp",
                entity="users",
                entity_id=user.id,
                ip=client_address(request),
            )
            raise ApiError(ErrorCode.UNAUTHORIZED, "Неверный код подтверждения.")

    tokens = _issue_tokens(user)
    _set_auth_cookies(response, tokens)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="login",
        entity="users",
        entity_id=user.id,
        ip=client_address(request),
    )
    return LoginResponse(status="ok", tokens=tokens)


@router.post("/refresh", response_model=TokenPair, summary="Обновить пару токенов")
@limiter.limit(REFRESH_RATE_LIMIT)
async def refresh(
    payload: RefreshRequest, request: Request, response: Response, session: SessionDep
) -> TokenPair:
    """Токен берётся из тела или из httpOnly cookie — но никогда из query-строки:
    URL оседает в логах nginx, истории браузера и заголовке Referer."""

    token = payload.refresh_token or request.cookies.get("refresh_token")
    if not token:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Токен обновления не передан.")

    claims = decode_token(token, expected_type="refresh")

    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Недействительный токен.") from exc

    user = await users_repo.get(session, user_id)
    if user is None or not user.is_active:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись недоступна.")

    tokens = _issue_tokens(user)
    _set_auth_cookies(response, tokens)
    return tokens


@router.post("/logout", status_code=204, summary="Выход")
async def logout(response: Response) -> None:
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")


@router.post("/totp/setup", response_model=TotpSetupResponse, summary="Начать настройку 2FA")
@limiter.limit(AUTH_RATE_LIMIT)
async def totp_setup(
    payload: TotpSetupRequest,
    request: Request,
    user: TotpSetupUserDep,
    session: SessionDep,
) -> TotpSetupResponse:
    """Выдаёт секрет-кандидат. Действующий второй фактор не меняется до
    подтверждения кодом на /auth/totp/verify."""

    db_user = await users_repo.get(session, user.id)
    if db_user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    # Смена уже настроенной 2FA требует текущего кода: иначе угнанный access-токен
    # позволил бы молча заменить второй фактор и вытеснить владельца.
    if db_user.totp_secret is not None and not (
        payload.current_code and verify_totp(db_user.totp_secret, payload.current_code)
    ):
        raise ApiError(
            ErrorCode.UNAUTHORIZED,
            "Чтобы сменить второй фактор, введите текущий код подтверждения.",
        )

    # Идемпотентно: если настройка уже начата, возвращается ТОТ ЖЕ секрет-кандидат.
    # Иначе повторный вызов (перезагрузка страницы после сканирования QR, двойной
    # клик, повторный запуск эффекта в React) выдал бы новый секрет, и код из
    # приложения перестал бы подходить к тому, что лежит в базе.
    # Кандидат не активен, пока не подтверждён на /totp/verify, поэтому
    # переиспользовать его безопасно.
    secret = db_user.totp_pending_secret or generate_totp_secret()
    db_user.totp_pending_secret = secret
    await session.flush()

    # Запрос нового секрета — операция с учётной записью (правило 7 CLAUDE.md):
    # без этой записи попытки подменить второй фактор, не доведённые до verify,
    # не оставляли бы следа в аудите.
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="totp_setup_requested",
        entity="users",
        entity_id=user.id,
        ip=client_address(request),
    )

    return TotpSetupResponse(
        secret=secret, provisioning_uri=totp_provisioning_uri(secret, email=db_user.email)
    )


@router.post("/totp/verify", response_model=TokenPair, summary="Подтвердить и включить 2FA")
@limiter.limit(AUTH_RATE_LIMIT)
async def totp_verify(
    payload: TotpVerifyRequest,
    request: Request,
    response: Response,
    user: TotpSetupUserDep,
    session: SessionDep,
) -> TokenPair:
    """Активирует секрет-кандидат и завершает вход: после первичной настройки
    пользователь сразу получает рабочую пару токенов."""

    db_user = await users_repo.get(session, user.id)
    if db_user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    if db_user.totp_pending_secret is None:
        raise ApiError(ErrorCode.CONFLICT, "Сначала запросите настройку через /auth/totp/setup.")

    if not verify_totp(db_user.totp_pending_secret, payload.code):
        raise ApiError(ErrorCode.UNAUTHORIZED, "Неверный код подтверждения.")

    db_user.totp_secret = db_user.totp_pending_secret
    db_user.totp_pending_secret = None
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="totp_enabled",
        entity="users",
        entity_id=user.id,
        ip=client_address(request),
    )

    tokens = _issue_tokens(db_user)
    _set_auth_cookies(response, tokens)
    return tokens


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
@limiter.limit(AUTH_RATE_LIMIT)
async def accept_invitation(
    payload: InvitationAccept, request: Request, session: SessionDep
) -> UserRead:
    # Атомарный claim: проверка и отметка о принятии — один UPDATE, поэтому два
    # параллельных запроса с одним токеном не создадут двух пользователей.
    invitation = await invitations_repo.claim(session, payload.token)
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
        password_hash=await hash_password_async(payload.password),
        phone=payload.phone,
    )

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="accept_invitation",
        entity="users",
        entity_id=user.id,
        after={"email": user.email, "role": user.role.value},
    )
    return UserRead.model_validate(user)
