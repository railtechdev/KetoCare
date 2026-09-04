"""Схемы помощника семьи (раздел 10.4 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_QUESTION = 2000


class AssistantAsk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Обязателен, а не опционален, как в `/calc`. Переписка о ребёнке обязана
    #: быть привязана к нему: иначе её не удалит `erase_patient` (ADR-0019), а
    #: врач не увидит переписку своего пациента (раздел 10.4).
    patient_id: uuid.UUID
    #: Продолжение разговора; пусто — начинается новый.
    conversation_id: uuid.UUID | None = None
    text: Annotated[str, Field(min_length=2, max_length=MAX_QUESTION)]


class AssistantAccepted(BaseModel):
    """Вопрос принят. Ответ дописывается воркером и читается той же ручкой."""

    conversation_id: uuid.UUID
    question_seq: int
    reply_seq: int


class MessageRead(BaseModel):
    seq: int
    id: uuid.UUID
    role: Literal["user", "assistant"]
    text: str
    created_at: datetime
    status: Literal["pending", "done", "failed"]
    sources: list[str] = []
    #: Ответ заменён шаблоном постфильтром. Экран показывает его обычным
    #: сообщением: это ответ по существу, просто не тот, которого ждали.
    blocked: bool = False


class ConversationRead(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID | None
    channel: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageRead]


class ConversationListItem(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID | None
    channel: str
    created_at: datetime
    updated_at: datetime
    messages_count: int
    #: Первый вопрос — им разговор и называется в списке.
    preview: str
