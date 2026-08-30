"""`/auth` — вход, refresh, 2FA (раздел 5.2-5.3 ТЗ).

2FA обязательна для admin/doctor/dietitian, для родителя — опциональна.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response

from core.models import User
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import backup_codes as backup_codes_repo
from core.repositories import invitations as invitations_repo
from core.repositories import users as users_repo

from ..client_address import client_address
from ..cookies import set_auth_cookies
from ..deps.auth import (
    CurrentUserDep,
    PasswordResetUserDep,
    SessionDep,
    TotpSetupUserDep,
    require_roles,
)
from ..errors import ApiError, ErrorCode
from ..ratelimit import AUTH_RATE_LIMIT, REFRESH_RATE_LIMIT, limiter
from ..schemas import (
    BackupCodes,
    BackupCodesRegenerate,
    BackupCodesStatus,
    InvitationAccept,
    InvitationCreate,
    InvitationCreated,
    LoginRequest,
    LoginResponse,
    PasswordSet,
    RefreshRequest,
    TokenPair,
    TotpEnabledResponse,
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
    token_predates_password_change,
    totp_provisioning_uri,
    verify_password_async,
    verify_totp,
    waste_password_verification_async,
)

router = APIRouter(prefix="/auth", tags=["auth"])

ROLES_REQUIRING_TOTP = frozenset({UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN})

_INVALID_CREDENTIALS = "Неверный email или пароль."


def _issue_tokens(user: User) -> TokenPair:
    """Оба токена несут отметку смены пароля: по ней отзываются старые сессии."""

    return TokenPair(
        access_token=create_token(
            user_id=user.id,
            role=user.role,
            token_type="access",
            password_changed_at=user.password_changed_at,
        ),
        refresh_token=create_token(
            user_id=user.id,
            role=user.role,
            token_type="refresh",
            password_changed_at=user.password_changed_at,
        ),
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

        # Резервный код — второй фактор для случая «телефона с приложением нет»
        # (NIST SP 800-63B, §5.1.2). Без него потерянный телефон означал потерю
        # учётной записи навсегда: отключить второй фактор нельзя, сброса не
        # было ни у кого. Код одноразовый и гасится атомарно.
        by_backup = False
        if payload.backup_code:
            by_backup = await backup_codes_repo.consume(
                session, user_id=user.id, code=payload.backup_code
            )

        if not by_backup and (
            not payload.totp_code or not verify_totp(user.totp_secret, payload.totp_code)
        ):
            await audit_repo.write_audit_log_independent(
                user_id=user.id,
                action="login_failed_totp",
                entity="users",
                entity_id=user.id,
                ip=client_address(request),
            )
            raise ApiError(ErrorCode.UNAUTHORIZED, "Неверный код подтверждения.")

        if by_backup:
            # Отдельной записью: использование резервного кода — событие, о
            # котором владелец учётной записи должен узнать из журнала.
            await audit_repo.write_audit_log(
                session,
                user_id=user.id,
                action="login_with_backup_code",
                entity="users",
                entity_id=user.id,
                ip=client_address(request),
            )

    if user.password_change_required:
        # После проверки пароля и второго фактора, а не вместо них: временный
        # пароль сокращает путь до смены, но не отменяет ни одной проверки.
        #
        # Рабочих токенов здесь не выдаётся вовсе. Иначе человек получал бы
        # сессию, а вместе с ней возможность не менять пароль, который знает
        # администратор, — то есть признак не значил бы ничего.
        return LoginResponse(
            status="password_change_required",
            password_reset_token=create_token(
                user_id=user.id, role=user.role, token_type="password_reset"
            ),
        )

    tokens = _issue_tokens(user)
    set_auth_cookies(response, tokens)

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

    if token_predates_password_change(claims, user.password_changed_at):
        raise ApiError(ErrorCode.UNAUTHORIZED, "Пароль изменён, войдите заново.")

    tokens = _issue_tokens(user)
    set_auth_cookies(response, tokens)
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


@router.post(
    "/totp/verify",
    response_model=TotpEnabledResponse,
    summary="Подтвердить и включить 2FA",
)
@limiter.limit(AUTH_RATE_LIMIT)
async def totp_verify(
    payload: TotpVerifyRequest,
    request: Request,
    response: Response,
    user: TotpSetupUserDep,
    session: SessionDep,
) -> TotpEnabledResponse:
    """Активирует секрет-кандидат и завершает вход: после первичной настройки
    пользователь сразу получает рабочую пару токенов.

    Здесь же выдаётся набор резервных кодов — это единственный момент, когда их
    можно показать: в базе лежит только sha256, повторить показ невозможно.
    Прежний набор при смене второго фактора заменяется: он был привязан к
    прежнему устройству."""

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

    codes = await backup_codes_repo.replace_for_user(session, user_id=user.id)

    tokens = _issue_tokens(db_user)
    set_auth_cookies(response, tokens)
    return TotpEnabledResponse(tokens=tokens, backup_codes=codes)


# Кто кого приглашает (ADR-0003): администратор заводит персонал, врач и диетолог —
# семьи. Разделение не косметическое: специалист, пригласивший родителя, становится
# ведущим для его ребёнка (см. routers/patients.py), поэтому приглашение семьи от
# администратора оставило бы пациента без врача, а «взять» пациента врач не может —
# такой ручки нет намеренно.
INVITER_ROLES = (UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN)
STAFF_ROLES = (UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN)


@router.post(
    "/invitations",
    response_model=InvitationCreated,
    status_code=201,
    summary="Пригласить пользователя",
    dependencies=[Depends(require_roles(*INVITER_ROLES))],
)
async def create_invitation(
    payload: InvitationCreate, user: CurrentUserDep, session: SessionDep
) -> InvitationCreated:
    if user.role is UserRole.ADMIN and payload.role is UserRole.PARENT:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Семью приглашает её врач или диетолог: он же становится ведущим специалистом.",
        )
    if user.role is not UserRole.ADMIN and payload.role in STAFF_ROLES:
        raise ApiError(ErrorCode.FORBIDDEN, "Сотрудников приглашает администратор.")

    existing = await users_repo.get_by_email(session, payload.email)
    if existing is not None:
        raise ApiError(ErrorCode.CONFLICT, "Пользователь с таким email уже существует.")

    token = invitations_repo.generate_token()
    invitation = await invitations_repo.create(
        session, email=payload.email, role=payload.role, token=token, created_by=user.id
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
        # След от приглашения к учётной записи. Для семьи он определяет ведущего
        # специалиста её ребёнка (ADR-0003), поэтому теряться не должен.
        invited_by=invitation.created_by,
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


@router.get(
    "/backup-codes",
    response_model=BackupCodesStatus,
    summary="Сколько резервных кодов осталось",
)
async def backup_codes_status(
    user: CurrentUserDep,
    session: SessionDep,
) -> BackupCodesStatus:
    """Набор кончается молча: девять входов резервными кодами подряд оставили бы
    владельца с одним кодом и без предупреждения."""

    remaining = await backup_codes_repo.count_unused(session, user_id=user.id)
    return BackupCodesStatus(remaining=remaining, total=backup_codes_repo.BACKUP_CODE_COUNT)


@router.post(
    "/backup-codes",
    response_model=BackupCodes,
    summary="Выпустить резервные коды заново",
)
@limiter.limit(AUTH_RATE_LIMIT)
async def regenerate_backup_codes(
    payload: BackupCodesRegenerate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> BackupCodes:
    """Перевыпуск требует кода приложения, а не только открытой сессии.

    Иначе чужой доступ к незакрытой вкладке позволял бы выпустить себе набор
    кодов на будущее — то есть превратить временный доступ в постоянный, минуя
    второй фактор.

    Прежний набор стирается: он мог попасть в чужие руки, ради чего перевыпуск и
    затевают.
    """

    db_user = await users_repo.get(session, user.id)
    if db_user is None or db_user.totp_secret is None:
        raise ApiError(ErrorCode.CONFLICT, "Второй фактор не настроен.")

    if not verify_totp(db_user.totp_secret, payload.totp_code):
        raise ApiError(ErrorCode.UNAUTHORIZED, "Неверный код подтверждения.")

    codes = await backup_codes_repo.replace_for_user(session, user_id=user.id)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="backup_codes_regenerated",
        entity="users",
        entity_id=user.id,
        ip=client_address(request),
    )

    return BackupCodes(codes=codes)


@router.post(
    "/password/set",
    response_model=TokenPair,
    summary="Задать пароль после сброса администратором",
)
@limiter.limit(AUTH_RATE_LIMIT)
async def set_password_after_reset(
    payload: PasswordSet,
    request: Request,
    response: Response,
    user: PasswordResetUserDep,
    session: SessionDep,
) -> TokenPair:
    """Завершает вход тому, кому администратор сбросил пароль.

    Текущий пароль не спрашивается: владелец его не знает, а временный знает
    ещё и администратор. Именно поэтому вход и не выдавал рабочих токенов,
    пока пароль не заменён.

    Отметка `password_changed_at` обрывает все прежние сессии (раздел 11 ТЗ) —
    в том числе те, что мог открыть кто-то с временным паролем на руках.
    """

    db_user = await users_repo.get(session, user.id)
    if db_user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    if await verify_password_async(db_user.password_hash, payload.new_password):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Новый пароль совпадает с временным. Задайте другой.",
        )

    db_user.password_hash = await hash_password_async(payload.new_password)
    db_user.password_changed_at = datetime.now(UTC)
    db_user.password_change_required = False
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="password_changed",
        entity="users",
        entity_id=user.id,
        ip=client_address(request),
    )

    tokens = _issue_tokens(db_user)
    set_auth_cookies(response, tokens)
    return tokens
