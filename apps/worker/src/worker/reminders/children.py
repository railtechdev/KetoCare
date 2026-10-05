"""Про какого ребёнка сообщение — когда чат ведёт нескольких (ADR-0048).

Чат одного ребёнка получает сообщения как прежде, без имени: незачем, и тексты
остаются теми, что согласовывались. Чату двоих детей «пора измерить кетоны» не
говорит, кому, — тогда над текстом стоит имя ребёнка. Только имя, без фамилии:
раздел 7.5 ТЗ запрещает показывать в чате параметры назначения, а не имена, но
фамилии в переписке Telegram незачем.
"""

from __future__ import annotations

import uuid
from typing import Any

from core.names import first_name
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo


def named(text: str, child: str | None) -> str:
    """Тот же вид, что у бота (`bot.deps.named`): имя строкой над сообщением."""

    return f"👶 {child}\n{text}" if child else text


async def child_names(
    session: Any, *, patient_id: uuid.UUID, chat_ids: list[int]
) -> dict[int, str | None]:
    """Имя ребёнка для каждого чата, которому оно нужно; остальным — None."""

    counts = await telegram_repo.children_per_chat(session, chat_ids)
    if not any(count >= 2 for count in counts.values()):
        return dict.fromkeys(chat_ids)
    patient = await patients_repo.get(session, patient_id)
    name = first_name(patient.full_name) if patient is not None else None
    return {chat_id: name if counts.get(chat_id, 0) >= 2 else None for chat_id in chat_ids}
