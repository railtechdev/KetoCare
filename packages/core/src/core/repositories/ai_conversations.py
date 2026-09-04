"""Переписка семьи с помощником (раздел 10.4 ТЗ).

Хранится одной строкой на разговор: сообщения — массив JSONB. Отдельной таблицы
сообщений нет намеренно — переписка читается и пишется целиком, а по одному
сообщению её никто не ищет.

Дописывание идёт через `SELECT … FOR UPDATE`: родитель может отправить второй
вопрос, пока воркер дописывает ответ на первый, и без блокировки один из них
затёр бы другого — JSONB переписывается целиком.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AiConversation
from ..models.enums import AiConversationChannel
from ..schemas.ai_conversations import AssistantMessage, parse_messages

#: Предел длины разговора. Строка переписывается целиком на каждое сообщение, и
#: без предела она растёт, пока запись не станет дороже ответа. Новый вопрос
#: после предела начинает новый разговор — это решение экрана, не репозитория.
MAX_MESSAGES = 200


async def create(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    patient_id: uuid.UUID,
    channel: AiConversationChannel,
) -> AiConversation:
    conversation = AiConversation(
        user_id=user_id, patient_id=patient_id, channel=channel, messages=[]
    )
    session.add(conversation)
    await session.flush()
    return conversation


async def get(session: AsyncSession, conversation_id: uuid.UUID) -> AiConversation | None:
    found: AiConversation | None = await session.get(AiConversation, conversation_id)
    return found


async def get_for_update(
    session: AsyncSession, conversation_id: uuid.UUID
) -> AiConversation | None:
    """Взять разговор под блокировку строки — для дописывания."""

    found: AiConversation | None = await session.scalar(
        select(AiConversation).where(AiConversation.id == conversation_id).with_for_update()
    )
    return found


async def list_for_patient(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    owner_id: uuid.UUID | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[AiConversation], int]:
    """Разговоры о ребёнке. `owner_id` сужает до своих — так читает родитель."""

    condition = AiConversation.patient_id == patient_id
    stmt = select(AiConversation).where(condition)
    if owner_id is not None:
        stmt = stmt.where(AiConversation.user_id == owner_id)

    total = len((await session.scalars(stmt)).all())
    items = list(
        await session.scalars(
            stmt.order_by(AiConversation.updated_at.desc()).limit(limit).offset(offset)
        )
    )
    return items, total


def messages_of(conversation: AiConversation) -> list[AssistantMessage]:
    return parse_messages(conversation.messages or [])


async def append(
    session: AsyncSession, *, conversation: AiConversation, messages: list[AssistantMessage]
) -> AiConversation:
    """Дописать сообщения в конец разговора."""

    stored = list(conversation.messages or [])
    stored.extend(message.dump() for message in messages)
    # Обрезаем с начала: свежие сообщения нужнее старых, а разговор без предела
    # растёт, пока строка не станет дороже ответа.
    conversation.messages = stored[-MAX_MESSAGES:]
    conversation.updated_at = datetime.now(UTC)
    await session.flush()
    return conversation


async def replace_message(
    session: AsyncSession, *, conversation: AiConversation, message: AssistantMessage
) -> AiConversation:
    """Заменить сообщение с тем же `seq` — так «ожидание» становится ответом."""

    stored = [item for item in (conversation.messages or []) if item.get("seq") != message.seq]
    stored.append(message.dump())
    conversation.messages = sorted(stored, key=lambda item: item.get("seq", 0))[-MAX_MESSAGES:]
    conversation.updated_at = datetime.now(UTC)
    await session.flush()
    return conversation


def next_seq(conversation: AiConversation) -> int:
    stored = conversation.messages or []
    return max((int(item.get("seq", 0)) for item in stored), default=-1) + 1
