"""Зависимости аутентификации и RBAC (раздел 5.1-5.2 ТЗ).

Правило 5 (CLAUDE.md): разграничение доступа проверяется на сервере.
Любая ручка с данными пациента обязана использовать `require_patient_access`.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable, Coroutine
from dataclasses import dataclass
from typing import Annotated, Any, cast, get_args

from fastapi import Depends, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.db import get_sessionmaker
from core.models.enums import UserRole
from core.repositories import access as access_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from ..errors import ApiError, ErrorCode
from ..security import (
    Channel,
    auth_challenge,
    decode_token,
    token_predates_password_change,
)
from .bot import assert_route_allowed_for_bot


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
    # Откуда пришёл токен. `bot` — автоматика, получившая токен по секрету
    # привязки, а не человек, вошедший паролем (ADR-0009). Отличать нужно, чтобы
    # токен бота не открывал то, что предназначено человеку: обновление сессии,
    # настройку второго фактора, выпуск новых кодов привязки.
    channel: Channel = "web"


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token

    # Web использует httpOnly cookie, Mini App — заголовок (раздел 5.2 ТЗ)
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token

    raise auth_challenge("Требуется вход в систему.")


async def get_current_user(request: Request, session: SessionDep) -> CurrentUser:
    payload = decode_token(_bearer_token(request), expected_type="access")

    try:
        user_id = uuid.UUID(payload["sub"])
        role = UserRole(payload["role"])
    except (KeyError, ValueError) as exc:
        raise auth_challenge("Недействительный токен.") from exc

    user = await users_repo.get(session, user_id)
    if user is None or not user.is_active:
        raise auth_challenge("Учётная запись недоступна.")

    # Роль берётся из БД, а не из токена: понижение прав должно действовать сразу,
    # не дожидаясь истечения выданного access-токена.
    if user.role is not role:
        raise auth_challenge("Права учётной записи изменились, войдите заново.")

    # Смена пароля обрывает все прежние сессии (раздел 11 ТЗ). Проверка здесь, а
    # не только при обновлении токена: иначе угнанный access-токен продолжал бы
    # работать до пятнадцати минут после того, как владелец сменил пароль.
    # Дополнительного запроса это не стоит — пользователь уже прочитан выше.
    if token_predates_password_change(payload, user.password_changed_at):
        raise auth_challenge("Пароль изменён, войдите заново.")

    scope_raw = payload.get("patient_scope")
    patient_scope = uuid.UUID(scope_raw) if scope_raw else None

    channel = channel_of(payload)
    if channel == "bot":
        # Единственная точка, через которую проходит любой пользовательский
        # токен, — здесь и стоит ограничение маршрутов для бота. Отдельная
        # зависимость, которую надо не забыть навесить на ручку, однажды
        # окажется не навешенной.
        assert_route_allowed_for_bot(request)
    if channel in ("bot", "miniapp"):
        # Оба канала живут привязкой чата, а не паролем: отозвали привязку —
        # доступ кончился сейчас, а не через пятнадцать минут. Ограничения
        # маршрутов у Mini App нет: там работает человек, вошедший в кабинет
        # ребёнка, а не автоматика по секрету (раздел 9 ТЗ).
        await _assert_binding_alive(session, payload, user_id=user.id, patient_scope=patient_scope)

    return CurrentUser(
        id=user.id,
        role=user.role,
        patient_scope=patient_scope,
        channel=channel,
    )


async def _assert_binding_alive(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    user_id: uuid.UUID,
    patient_scope: uuid.UUID | None,
) -> None:
    """Проверяет, что привязка, по которой выдан ботовый токен, ещё жива.

    Без этого отвязка не отвязывала: `revoke` ставит `revoked_at`, но уже
    выданный access-токен живёт пятнадцать минут и всё это время писал бы в
    дневник ребёнка. Ровно от этого разрыва в сценарии «потерял телефон →
    отвязал в кабинете» защита и нужна.

    Запрос выполняется только для канала `bot` — сессии человека его не платят.
    Он же и причина, по которой `link_id` попадает в токен: иначе привязку
    пришлось бы искать по родителю и пациенту, а их у семьи может быть
    несколько, и отзыв одного чата гасил бы все.
    """

    denied = auth_challenge("Привязка отозвана, требуется повторная привязка.")

    raw = payload.get("tg")
    if not isinstance(raw, str):
        raise denied
    try:
        binding_id = uuid.UUID(raw)
    except ValueError as exc:
        raise denied from exc

    link = await telegram_repo.get_active_link(session, binding_id)
    if link is None:
        raise denied
    # Сверка с содержимым токена: подписанные claim'ы и строка в БД должны
    # описывать одну и ту же привязку. Расхождение означает подделку или
    # изменение данных под выданным токеном — в обоих случаях отказ.
    if link.parent_id != user_id or link.patient_id != patient_scope:
        raise denied


def channel_of(payload: dict[str, Any]) -> Channel:
    """Канал из claim `chan`. Неизвестное значение — не «web по умолчанию».

    Публичная: обновление токенов в `/auth/refresh` обязано знать канал, иначе
    оно повышало бы сужённый токен до полноценной веб-сессии.

    Неизвестный канал означает токен, выпущенный кодом, которого эта версия API
    не знает. Считать его самым доверенным вариантом нельзя: так новый канал с
    послаблениями молча получил бы права web-сессии на старом узле при
    раскатке. Отказ здесь дороже в эксплуатации, но дешевле в последствиях.
    """

    raw = payload.get("chan")
    if raw is None:
        return "web"
    if raw in get_args(Channel):
        return cast(Channel, raw)
    raise auth_challenge("Недействительный токен.")


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


async def assert_patient_access(
    session: AsyncSession, user: CurrentUser, patient_id: uuid.UUID
) -> None:
    """Обе ступени проверки доступа к пациенту — одним местом.

    Ручки, у которых `{patient_id}` нет в пути (задача отчёта знает пациента
    сама), проверяют доступ вручную и обязаны звать именно это, а не репозиторий
    напрямую. Раньше такая ручка была одна и повторяла только вторую ступень,
    без сверки `patient_scope`: пока scope-токены не выпускались, разницы не
    было, но первый же их выпуск открыл бы этот путь мимо сужения.
    """

    # Токен, суженный до одного пациента (Mini App, бот), — сузить его нельзя обойти
    if user.patient_scope is not None and user.patient_scope != patient_id:
        raise ApiError(ErrorCode.FORBIDDEN, "Нет доступа к данным этого пациента.")

    allowed = await access_repo.user_has_patient_access(
        session, user_id=user.id, role=user.role, patient_id=patient_id
    )
    if not allowed:
        raise ApiError(ErrorCode.FORBIDDEN, "Нет доступа к данным этого пациента.")


async def require_patient_access(
    patient_id: Annotated[uuid.UUID, Path()],
    user: CurrentUserDep,
    session: SessionDep,
) -> CurrentUser:
    """Проверяет связь текущего пользователя с пациентом (раздел 5.1 ТЗ).

    Админ к клиническим данным доступа не имеет — это обеспечивает
    `core.repositories.access`, возвращая False для роли admin.
    """

    await assert_patient_access(session, user, patient_id)
    return user


PatientAccessDep = Annotated[CurrentUser, Depends(require_patient_access)]


async def accessible_patient_ids(user: CurrentUserDep, session: SessionDep) -> list[uuid.UUID]:
    """Идентификаторы пациентов, доступных текущему пользователю.

    Зависимость для КОЛЛЕКЦИОННЫХ ручек — тех, что не принимают `{patient_id}` и
    потому не проходят через `require_patient_access` (списки дневников, отчёты,
    выгрузки — всё, что появляется на этапах 2-4). Сужение по `patient_scope`
    выполняется здесь один раз: если бы каждая такая ручка фильтровала сама,
    достаточно было бы забыть об этом в одной, чтобы токен Mini App увидел чужих
    детей — молча, без ошибки.

    Админ получает пустой список: клинических данных он не видит (раздел 5.1 ТЗ).
    """

    ids = await access_repo.list_accessible_patient_ids(session, user_id=user.id, role=user.role)

    if user.patient_scope is not None:
        return [pid for pid in ids if pid == user.patient_scope]
    return ids


AccessiblePatientsDep = Annotated[list[uuid.UUID], Depends(accessible_patient_ids)]


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

    # Токен бота сюда не пускается. Он выдан автоматике по секрету привязки, а
    # второй фактор — это личная вещь человека: с ботовым токеном можно было бы
    # перевыпустить TOTP-секрет родителя и тем самым превратить временный доступ
    # к чату в постоянный вход в кабинет (ADR-0009).
    if channel_of(payload) != "web":
        raise ApiError(ErrorCode.FORBIDDEN, "Это действие недоступно из Telegram-бота.")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise auth_challenge("Недействительный токен.") from exc

    user = await users_repo.get(session, user_id)
    if user is None or not user.is_active:
        raise auth_challenge("Учётная запись недоступна.")

    return CurrentUser(id=user.id, role=user.role)


TotpSetupUserDep = Annotated[CurrentUser, Depends(get_totp_setup_user)]


async def get_password_reset_user(request: Request, session: SessionDep) -> CurrentUser:
    """Пользователь, обязанный задать себе новый пароль.

    Принимает только `password_reset`-токен, выданный `/auth/login` тому, кому
    администратор сбросил пароль. Обычный access-токен сюда не подходит: у
    такого человека рабочей сессии ещё нет — он её и получит, задав пароль.

    Смена уже известного пароля живёт отдельно (`POST /users/me/password`) и
    требует текущего: две разные задачи, и слить их значило бы разрешить смену
    пароля без знания старого по любому access-токену.
    """

    payload = decode_token(_bearer_token(request), expected_type="password_reset")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise auth_challenge("Недействительный токен.") from exc

    user = await users_repo.get(session, user_id)
    if user is None or not user.is_active:
        raise auth_challenge("Учётная запись недоступна.")

    return CurrentUser(id=user.id, role=user.role)


PasswordResetUserDep = Annotated[CurrentUser, Depends(get_password_reset_user)]
