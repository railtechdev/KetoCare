"""Контракт сообщения в переписке с помощником (раздел 10.4 ТЗ).

Переписка лежит в `ai_conversations.messages` — JSONB, то есть база форму не
проверяет. Значит, форму проверяет этот модуль, и он единственный: строка,
записанная мимо него, читается всеми экранами и ломает их по-разному.

Каждому сообщению нужен номер (`seq`), а не только время: клиент дочитывает
переписку по `?after_seq=`, а два сообщения в одну миллисекунду — обычное дело,
когда ответ приходит сразу за вопросом.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["user", "assistant"]
#: `pending` бывает только у ответа помощника: он появляется пустым сразу, а
#: текст дописывает воркер. Экран рисует на этом месте ожидание.
Status = Literal["pending", "done", "failed"]

MAX_TEXT = 4000


class AssistantMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seq: int = Field(ge=0)
    id: uuid.UUID
    role: Role
    text: str = Field(default="", max_length=MAX_TEXT)
    created_at: datetime
    status: Status = "done"
    #: Строка журнала, из которой пришёл ответ: по ней разбирают жалобы.
    ai_job_id: uuid.UUID | None = None
    #: Статьи базы знаний, на которые опирается ответ.
    sources: list[str] = []
    #: Ответ заменён шаблоном постфильтром — экран показывает его обычным
    #: сообщением, а не ошибкой: это ответ по существу, просто не тот.
    blocked: bool = False

    def dump(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


def new_message(
    *,
    seq: int,
    role: Role,
    text: str = "",
    status: Status = "done",
    blocked: bool = False,
    sources: list[str] | None = None,
    ai_job_id: uuid.UUID | None = None,
) -> AssistantMessage:
    return AssistantMessage(
        seq=seq,
        id=uuid.uuid4(),
        role=role,
        text=text[:MAX_TEXT],
        created_at=datetime.now(UTC),
        status=status,
        blocked=blocked,
        sources=sources or [],
        ai_job_id=ai_job_id,
    )


def parse_messages(raw: list[dict[str, Any]]) -> list[AssistantMessage]:
    """Прочитать переписку из JSONB.

    Строки, не подходящие под контракт, пропускаются, а не роняют экран:
    переписка — не расчёт, и одно испорченное сообщение не повод спрятать от
    семьи остальные.
    """

    messages: list[AssistantMessage] = []
    for item in raw:
        try:
            messages.append(AssistantMessage.model_validate(item))
        except ValueError:
            continue
    return sorted(messages, key=lambda message: message.seq)
