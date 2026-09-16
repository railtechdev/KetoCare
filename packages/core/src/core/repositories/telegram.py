"""Привязка Telegram-чата к паре «родитель + ребёнок» (раздел 7.1 ТЗ, ADR-0009).

`telegram_accounts` — сама привязка. Хранит sha256 секрета, который бот
предъявляет как второй фактор; сам секрет отдаётся боту один раз при привязке.

Кода привязки здесь больше нет: с ADR-0040 вид кода один — `access_codes`, и
живёт он в своём репозитории. Прежние `link_codes` понимал только бот, и семья,
пришедшая с кодом от врача, получала в боте отказ.

Почему секрет, а не один сервисный токен: `BOT_API_TOKEN` — статичная строка в
окружении, и её утечка (лог, дамп env, CI, Sentry) не должна открывать
клинические данные ребёнка. `chat_id` секретом не является — Telegram-id
полупубличны и перебираемы, поэтому «токен + chat_id» это один фактор, а не два.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TelegramAccount

# Секрет привязки: 32 байта энтропии. В отличие от кода его не диктуют и не
# переписывают — он живёт в хранилище бота, поэтому читаемость не нужна.
BINDING_SECRET_BYTES = 32


def generate_binding_secret() -> str:
    return secrets.token_urlsafe(BINDING_SECRET_BYTES)


def hash_secret(secret: str) -> str:
    """sha256 в hex — ровно 64 символа, как и объявлено в модели.

    Медленный хеш (argon2, как у паролей) здесь не нужен и вреден: секрет
    предъявляется на каждом запросе бота и обладает полной машинной энтропией,
    перебирать его по словарю нечем.
    """

    return hashlib.sha256(secret.encode()).hexdigest()


async def get_active_link_by_chat(session: AsyncSession, chat_id: int) -> TelegramAccount | None:
    stmt = select(TelegramAccount).where(
        TelegramAccount.chat_id == chat_id,
        TelegramAccount.revoked_at.is_(None),
    )
    link: TelegramAccount | None = await session.scalar(stmt)
    return link


async def get_active_link(session: AsyncSession, link_id: uuid.UUID) -> TelegramAccount | None:
    stmt = select(TelegramAccount).where(
        TelegramAccount.id == link_id,
        TelegramAccount.revoked_at.is_(None),
    )
    link: TelegramAccount | None = await session.scalar(stmt)
    return link


async def list_links_for_patient(
    session: AsyncSession, patient_id: uuid.UUID
) -> list[TelegramAccount]:
    """Все привязки ребёнка, включая отозванные: кабинет показывает журнал.

    Раздел 7.1 ТЗ допускает несколько chat_id на семью, поэтому список, а не одна
    запись.
    """

    stmt = (
        select(TelegramAccount)
        .where(TelegramAccount.patient_id == patient_id)
        .order_by(TelegramAccount.linked_at.desc())
    )
    return list((await session.scalars(stmt)).all())


async def create_link(
    session: AsyncSession,
    *,
    parent_id: uuid.UUID,
    patient_id: uuid.UUID,
    chat_id: int,
    secret: str,
) -> TelegramAccount:
    """Создаёт привязку НОВОЙ строкой.

    Существующая строка с тем же `chat_id` никогда не обновляется: обновление по
    несекретному ключу — это способ угнать чужую привязку, а заодно потеря
    журнала о том, кому чат принадлежал раньше. Живая привязка чата снимается
    только явным `revoke`, и уже после него частичный уникальный индекс
    `uq_telegram_accounts_active_chat` пропустит новую строку.
    """

    link = TelegramAccount(
        parent_id=parent_id,
        patient_id=patient_id,
        chat_id=chat_id,
        secret_hash=hash_secret(secret),
        linked_at=datetime.now(UTC),
    )
    session.add(link)
    await session.flush()
    return link


async def revoke(session: AsyncSession, link_id: uuid.UUID) -> TelegramAccount | None:
    """Отзывает привязку. Идемпотентно: повторный отзыв вернёт None."""

    stmt = (
        update(TelegramAccount)
        .where(TelegramAccount.id == link_id, TelegramAccount.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
        .returning(TelegramAccount)
    )
    revoked: TelegramAccount | None = await session.scalar(stmt)
    return revoked
