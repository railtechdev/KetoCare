"""Общие зависимости обработчиков: привязка чата и запись в дневник.

Каждый сценарий раздела 7.3 заканчивается одинаково — берёт привязку, шлёт
запись, отвечает «Записано ✓» или объясняет отказ. Если это повторять в каждом
сценарии, обработка отзыва привязки однажды разойдётся между ними.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from . import keyboards, texts
from .api import BotApi, BotApiError, LinkRevokedError
from .storage import Binding, BindingStore

logger = structlog.get_logger(__name__)


async def require_binding(message: Message, store: BindingStore) -> Binding | None:
    """Привязка чата или None с объяснением, что делать.

    Возврат None — не ошибка: непривязанный чат это штатное состояние до
    `/start <код>`, и раздел 7.1 требует подсказать, где взять код.
    """

    binding = await store.get(message.chat.id)
    if binding is None:
        await message.answer(texts.NOT_LINKED)
        return None
    return binding


async def submit_log(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    binding: Binding,
    kind: str,
    payload: dict[str, Any],
) -> None:
    """Отправляет запись и закрывает сценарий.

    Отзыв привязки обрабатывается здесь: секрет перестал работать, значит запись
    не уйдёт никогда, и держать сценарий открытым бессмысленно. Локальная
    привязка удаляется — иначе бот бесконечно предъявлял бы мёртвый секрет.
    """

    body = {"occurred_at": datetime.now(UTC).isoformat(), **payload}
    try:
        await api.create_log(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            kind=kind,
            payload=body,
        )
    except LinkRevokedError:
        await store.delete(message.chat.id)
        await state.clear()
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        # Подробности — в лог, семье только «попробуйте ещё раз»: код ошибки ей
        # ничего не говорит, а тревоги добавляет.
        logger.warning("log_submit_failed", kind=kind, status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    await state.clear()
    await message.answer(texts.SAVED, reply_markup=keyboards.MAIN_MENU)
