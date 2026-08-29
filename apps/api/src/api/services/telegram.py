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
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from ..errors import ApiError, ErrorCode
from ..schemas_telegram import BotSession
from ..security import ACCESS_TOKEN_TTL, create_token


def build_deep_link(code: str) -> str | None:
    """`https://t.me/<бот>?start=<код>` — ссылка, которую родитель нажимает с телефона.

    Без настроенного `BOT_USERNAME` возвращает None: показать ссылку на
    несуществующего бота хуже, чем показать один только код.
    """

    username = get_settings().bot_username.lstrip("@")
    if not username:
        return None
    return f"https://t.me/{username}?start={code}"


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
