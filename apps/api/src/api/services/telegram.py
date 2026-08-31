"""Логика привязки Telegram (ADR-0009).

В роутере остаются только параметры и коды ответов; проверки секрета и сборка
токена — здесь.
"""

from __future__ import annotations

import hmac
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from ..errors import ApiError, ErrorCode
from ..schemas_telegram import BotSession, MiniAppSession
from ..security import ACCESS_TOKEN_TTL, TokenType, create_token
from .telegram_initdata import InitDataError, parse_init_data


def build_deep_link(code: str) -> str | None:
    """`https://t.me/<бот>?start=<код>` — ссылка, которую родитель нажимает с телефона.

    Без настроенного `BOT_USERNAME` возвращает None: показать ссылку на
    несуществующего бота хуже, чем показать один только код.
    """

    username = get_settings().bot_username.lstrip("@")
    if not username:
        return None
    return f"https://t.me/{username}?start={code}"


async def issue_miniapp_session(
    session: AsyncSession, *, init_data: str, ip: str | None
) -> MiniAppSession:
    """Меняет подписанную строку запуска на сессию родителя, суженную до ребёнка.

    Личность подтверждает Telegram своей подписью, а право на ребёнка — живая
    привязка чата: Mini App не заводит третьего способа доступа, он показывает
    то же, к чему семья уже привязала чат (раздел 9 ТЗ).

    Чат ищется по идентификатору пользователя Telegram: привязка рождается в
    личной переписке с ботом, где `chat_id` и есть идентификатор пользователя.
    В группе бот привязку не заводит вовсе, так что второго случая нет.
    """

    settings = get_settings()

    try:
        parsed = parse_init_data(init_data, bot_token=settings.bot_token)
    except InitDataError as exc:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Telegram не подтвердил запуск.") from exc

    link = await telegram_repo.get_active_link_by_chat(session, parsed.user_id)
    if link is None:
        # Отдельный код, а не «недостаточно прав»: приложению нужно показать
        # инструкцию по привязке, а не сообщение об отказе (раздел 9 ТЗ).
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "Этот Telegram не привязан ни к одному ребёнку. Привяжите его в кабинете.",
        )

    parent = await users_repo.get(session, link.parent_id)
    if parent is None or not parent.is_active or parent.role is not UserRole.PARENT:
        # Та же страховка от эскалации, что и у бота: привязка не должна
        # открывать права сотрудника, даже если `parent_id` когда-нибудь на
        # него укажет.
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись недоступна.")

    patient = await patients_repo.get(session, link.patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Ребёнок не найден.")

    def token(token_type: TokenType) -> str:
        return create_token(
            user_id=parent.id,
            role=UserRole.PARENT,
            token_type=token_type,
            patient_scope=link.patient_id,
            password_changed_at=parent.password_changed_at,
            channel="miniapp",
            binding_id=link.id,
        )

    # Вход — событие учётной записи (правило 7): по журналу видно, что сессия
    # ребёнка открыта из Telegram, а не паролем в кабинете.
    await audit_repo.write_audit_log(
        session,
        user_id=parent.id,
        action="login_miniapp",
        entity="telegram_accounts",
        entity_id=link.id,
        ip=ip,
    )

    return MiniAppSession(
        access_token=token("access"),
        refresh_token=token("refresh"),
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        patient_id=link.patient_id,
        patient_name=patient.full_name,
    )


async def issue_bot_session(
    session: AsyncSession, *, link_id: uuid.UUID, secret: str
) -> BotSession:
    """Меняет секрет привязки на access-токен, суженный до её пациента.

    Все отказы отвечают одинаково: по ответу нельзя отличить «нет такой
    привязки» от «неверный секрет» и от «привязка отозвана» — иначе перебор
    `link_id` показывал бы, какие привязки существуют.
    """

    denied = ApiError(ErrorCode.UNAUTHORIZED, "Привязка недействительна.")

    link = await telegram_repo.get_active_link(session, link_id)
    if link is None:
        raise denied

    # compare_digest по хешам: длина одинакова, а сравнение самих секретов
    # выдавало бы длину общего префикса временем ответа.
    if not hmac.compare_digest(telegram_repo.hash_secret(secret), link.secret_hash):
        raise denied

    parent = await users_repo.get(session, link.parent_id)
    if parent is None or not parent.is_active:
        raise denied
    if parent.role is not UserRole.PARENT:
        # Страховка от эскалации: если `parent_id` когда-нибудь укажет на
        # сотрудника, бот не должен получить его права.
        raise denied

    token = create_token(
        user_id=parent.id,
        role=UserRole.PARENT,
        token_type="access",
        patient_scope=link.patient_id,
        password_changed_at=parent.password_changed_at,
        channel="bot",
        binding_id=link.id,
    )
    return BotSession(
        access_token=token,
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        patient_id=link.patient_id,
    )
