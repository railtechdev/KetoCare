"""Общие зависимости обработчиков: привязка чата и запись в дневник.

Каждый сценарий раздела 7.3 заканчивается одинаково — берёт привязку, шлёт
запись, отвечает «Записано ✓» или объясняет отказ. Если это повторять в каждом
сценарии, обработка отзыва привязки однажды разойдётся между ними.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from . import keyboards, texts
from .api import TRANSPORT_ERROR, BotApi, BotApiError, LinkRevokedError
from .config import BotSettings
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


def when_text(occurred_at: datetime | None, *, tz: str) -> str:
    """Человеческое время для эха подтверждения.

    «Только что» — когда семья ответила «Сейчас»; иначе то время, которое она
    сама ввела, в её же формате: «сегодня в 07:30» или «29.08 в 21:00».
    """

    if occurred_at is None:
        return texts.WHEN_JUST_NOW

    zone = ZoneInfo(tz)
    local = occurred_at.astimezone(zone)
    if local.date() == datetime.now(zone).date():
        return texts.WHEN_TODAY_AT.format(time=local.strftime("%H:%M"))
    return texts.WHEN_DATE_AT.format(date=local.strftime("%d.%m"), time=local.strftime("%H:%M"))


async def submit_log(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    binding: Binding,
    kind: str,
    payload: dict[str, Any],
    summary: str,
    settings: BotSettings,
    occurred_at: datetime | None = None,
) -> None:
    """Отправляет запись и закрывает сценарий эхом того, что записано.

    Эхо, а не голое «Записано ✓»: подтверждение без содержимого не даёт
    заметить опечатку (3,2 против 32 — клиническая запись), а два подряд
    неотличимы друг от друга. `summary` собирает сценарий — только он знает,
    что именно вводила семья.

    Отзыв привязки обрабатывается здесь: секрет перестал работать, значит запись
    не уйдёт никогда, и держать сценарий открытым бессмысленно. Локальная
    привязка удаляется — иначе бот бесконечно предъявлял бы мёртвый секрет.
    """

    # Момент события задаёт семья: бот ставит «сейчас» только тогда, когда она
    # сама так ответила.
    # Ключ попытки и тело живут в состоянии сценария до успешной записи:
    # родитель, нажавший кнопку ещё раз после «нет связи», повторяет ТУ ЖЕ
    # запись — тот же ключ и то же тело, байт в байт. Иначе ответ «Сейчас»
    # давал бы новое `occurred_at`, сервер видел бы под старым ключом другой
    # запрос и отказывал, а запись, уже дошедшую до базы, семья завела бы
    # заново (находка ревью, 05.10.2026).
    data = await state.get_data()
    pending = data.get("pending_write")
    if isinstance(pending, dict) and pending.get("kind") == kind:
        key = str(pending["key"])
        body = dict(pending["body"])
    else:
        moment = occurred_at or datetime.now(UTC)
        key = str(uuid.uuid4())
        body = {"occurred_at": moment.isoformat(), **payload}
        await state.update_data(pending_write={"kind": kind, "key": key, "body": body})
    try:
        await api.create_log(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            kind=kind,
            payload=body,
            idempotency_key=key,
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
        if exc.code == TRANSPORT_ERROR:
            # Попытка остаётся в состоянии: повтор отправит её же.
            await message.answer(texts.NO_CONNECTION)
            return
        # Сервер ответил отказом — эта попытка закончена. Следующая будет новой
        # записью с новым ключом, а не вечным повтором отвергнутой.
        await state.update_data(pending_write=None)
        await message.answer(texts.API_UNAVAILABLE)
        return

    await state.clear()
    confirmation = (
        texts.SAVED.format(summary=summary, when=when_text(occurred_at, tz=settings.tz))
        if summary
        else texts.SAVED_BARE
    )
    await message.answer(confirmation, reply_markup=keyboards.main_menu(settings))
