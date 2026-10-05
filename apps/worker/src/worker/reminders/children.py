"""Про какого ребёнка сообщение — когда чат ведёт нескольких (ADR-0048).

Чат одного ребёнка получает сообщения как прежде, без имени: незачем, и тексты
остаются теми, что согласовывались. Чату двоих детей «пора измерить кетоны» не
говорит, кому, — тогда над текстом стоит имя ребёнка. Только имя, без фамилии:
раздел 7.5 ТЗ запрещает показывать в чате параметры назначения, а не имена, но
фамилии в переписке Telegram незачем.

Здесь же — на каком языке писать в чат (ADR-0052): адресат сообщения тот же, и
вопрос «кому» включает «на каком языке».
"""

from __future__ import annotations

import uuid
from typing import Any

from core.languages import Language, effective
from core.names import first_name
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo


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


async def chat_languages(session: Any, links: list[Any]) -> dict[int, Language]:
    """Язык каждого живого чата — язык взрослого, чей это чат (ADR-0052).

    Чат с двумя взрослыми получает язык первого из них: сообщение одно на чат,
    а не на человека. Чата нет в ответе (привязка без `parent_id`) — вызывающий
    пишет по-русски, как и до ADR-0052.
    """

    parent_of: dict[int, uuid.UUID] = {}
    for link in links:
        parent_id = getattr(link, "parent_id", None)
        if link.revoked_at is None and parent_id is not None:
            parent_of.setdefault(link.chat_id, parent_id)
    if not parent_of:
        return {}
    stored = await users_repo.languages_by_ids(session, user_ids=set(parent_of.values()))
    return {chat_id: effective(stored.get(parent_id)) for chat_id, parent_id in parent_of.items()}


async def parent_language(session: Any, parent_id: uuid.UUID) -> Language:
    """Язык одного взрослого — для сообщения, адресованного ему самому."""

    stored = await users_repo.languages_by_ids(session, user_ids={parent_id})
    return effective(stored.get(parent_id))
