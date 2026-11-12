"""Кнопки под ответом «Записано ✓»: другое время, метод кетонов, удаление (ADR-0076).

Запись сохраняется сразу, с моментом «сейчас». Прежде перед каждой записью
стоял шаг «Когда это было?» — лишнее нажатие в девяти записях из десяти, — а
поправить сохранённое из чата было нельзя вовсе: только в приложении.

Действие находит запись по квитанции (`BindingStore.receipt`): ребёнок, номера
записей и эхо. Правит и удаляет запись API — и только её автор, то есть
взрослый за этой привязкой (`services.logs._require_author`).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InaccessibleMessage, Message

from .. import card, keyboards, texts
from ..api import BotApi, BotApiError, LinkRevokedError
from ..config import BotSettings
from ..deps import echo_text, link_revoked
from ..event_time import MAX_BACKDATE, TimeError, parse_moment
from ..storage import Binding, BindingStore
from .scenarios import ketones_summary

logger = structlog.get_logger(__name__)

router = Router(name="records")
router.message.filter(F.chat.type == "private")

#: Время за кнопками «Сегодня в 08:00» и «Вчера в 20:00». Не медицинское число:
#: подпись кнопки называет его целиком, и эхо после выбора — тоже. Кто знает
#: точнее — пишет время сам.
MORNING_AT = time(8, 0)
EVENING_AT = time(20, 0)

_RECEIPT_KEY = "record_key"


class RecordTime(StatesGroup):
    """Ждём время записи: кнопкой или набранное (07:30, 29.08 21:00)."""

    waiting = State()


def _message(callback: CallbackQuery) -> Message | None:
    message = callback.message
    if message is None or isinstance(message, InaccessibleMessage):
        return None
    return message


async def _binding_for(
    store: BindingStore, chat_id: int, receipt: dict[str, Any]
) -> Binding | None:
    for binding in await store.all(chat_id):
        if str(binding.patient_id) == str(receipt.get("patient_id")):
            return binding
    return None


async def _context(
    callback: CallbackQuery, store: BindingStore, key: str
) -> tuple[Message, dict[str, Any]] | None:
    """Сообщение и квитанция записи — или None с ответом, почему нельзя."""

    message = _message(callback)
    receipt = await store.receipt(message.chat.id, key) if message is not None else None
    if message is None or receipt is None:
        await callback.answer(texts.RECORD_EXPIRED, show_alert=True)
        return None
    return message, receipt


def quick_moment(code: str, *, now: datetime, tz: str) -> datetime | None:
    """Момент быстрого варианта времени — в поясе семьи."""

    local = now.astimezone(ZoneInfo(tz))
    if code == keyboards.QUICK_15_MIN:
        return local - timedelta(minutes=15)
    if code == keyboards.QUICK_HOUR:
        return local - timedelta(hours=1)
    if code == keyboards.QUICK_MORNING:
        return local.replace(
            hour=MORNING_AT.hour, minute=MORNING_AT.minute, second=0, microsecond=0
        )
    if code == keyboards.QUICK_YESTERDAY_EVENING:
        return (local - timedelta(days=1)).replace(
            hour=EVENING_AT.hour, minute=EVENING_AT.minute, second=0, microsecond=0
        )
    return None


def _times_markup(key: str, settings: BotSettings) -> Any:
    now = datetime.now(ZoneInfo(settings.tz))
    return keyboards.record_times(
        key, morning=(now.hour, now.minute) >= (MORNING_AT.hour, MORNING_AT.minute)
    )


@router.callback_query(F.data.startswith(keyboards.RECORD_TIME_PREFIX))
async def other_time(
    callback: CallbackQuery, state: FSMContext, store: BindingStore, settings: BotSettings
) -> None:
    key = (callback.data or "").removeprefix(keyboards.RECORD_TIME_PREFIX)
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    await callback.answer()
    # Начатый сценарий закрывается: время ответа на «Когда?» — шаг этой записи.
    await state.clear()
    await state.set_state(RecordTime.waiting)
    await state.update_data({_RECEIPT_KEY: key})
    await card.show(
        message,
        state,
        texts.RECORD_TIME_ASK.format(summary=receipt.get("summary") or ""),
        _times_markup(key, settings),
        own=True,
    )


@router.callback_query(F.data.startswith(keyboards.RECORD_TYPE_PREFIX))
async def type_time(callback: CallbackQuery, state: FSMContext, store: BindingStore) -> None:
    key = (callback.data or "").removeprefix(keyboards.RECORD_TYPE_PREFIX)
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    await callback.answer()
    await state.set_state(RecordTime.waiting)
    await state.update_data({_RECEIPT_KEY: key})
    await card.show(
        message,
        state,
        texts.RECORD_TIME_TYPE.format(summary=receipt.get("summary") or ""),
        keyboards.record_back(key),
        own=True,
    )


@router.callback_query(F.data.startswith(keyboards.RECORD_QUICK_PREFIX))
async def quick_time(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    code, _, key = (callback.data or "").removeprefix(keyboards.RECORD_QUICK_PREFIX).partition(":")
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    now = datetime.now(ZoneInfo(settings.tz))
    moment = quick_moment(code, now=now, tz=settings.tz)
    if moment is None or moment > now or now - moment > MAX_BACKDATE:
        # Кнопка «Сегодня в 08:00», нажатая до восьми, — из старого сообщения.
        await callback.answer(texts.WHEN_IN_FUTURE, show_alert=True)
        return
    await callback.answer()
    await _apply_time(
        message,
        state,
        api=api,
        store=store,
        settings=settings,
        key=key,
        receipt=receipt,
        moment=moment,
        own=True,
    )


@router.message(RecordTime.waiting)
async def typed_time(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Время набрано текстом на шаге с кнопками времени — принимается так же."""

    key = str((await state.get_data()).get(_RECEIPT_KEY) or "")
    receipt = await store.receipt(message.chat.id, key) if key else None
    if receipt is None:
        await state.clear()
        await message.answer(texts.RECORD_EXPIRED)
        return
    moment = parse_moment(
        message.text or "", now=datetime.now(ZoneInfo(settings.tz)), tz=settings.tz
    )
    if isinstance(moment, TimeError):
        reason = {"future": texts.WHEN_IN_FUTURE, "too_old": texts.WHEN_TOO_OLD}.get(
            str(moment), texts.WHEN_BAD_FORMAT
        )
        await card.show(message, state, reason, _times_markup(key, settings))
        return
    await _apply_time(
        message,
        state,
        api=api,
        store=store,
        settings=settings,
        key=key,
        receipt=receipt,
        moment=moment,
        own=False,
    )


async def _apply_time(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    key: str,
    receipt: dict[str, Any],
    moment: datetime,
    own: bool,
) -> None:
    binding = await _binding_for(store, message.chat.id, receipt)
    if binding is None:
        await state.clear()
        await card.show(message, state, texts.RECORD_CHILD_GONE, None, own=own)
        return
    payload = {"occurred_at": moment.isoformat()}
    if not await _patch_all(
        message,
        state,
        api=api,
        store=store,
        settings=settings,
        binding=binding,
        key=key,
        receipt=receipt,
        payload=payload,
        own=own,
    ):
        return
    receipt = receipt | {"occurred_at": moment.isoformat()}
    await store.put_receipt(message.chat.id, key, receipt)
    await card.show(
        message,
        state,
        echo_text(receipt, tz=settings.tz),
        keyboards.record_actions(key, method=receipt.get("method")),
        own=own,
    )
    await state.clear()


async def _patch_all(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding,
    key: str,
    receipt: dict[str, Any],
    payload: dict[str, Any],
    own: bool,
) -> bool:
    """PATCH каждой записи квитанции; False — ответ о сбое уже показан."""

    for log_id in receipt.get("log_ids", []):
        try:
            await api.update_log(
                link_id=binding.link_id,
                secret=binding.secret,
                patient_id=binding.patient_id,
                kind=str(receipt["kind"]),
                log_id=str(log_id),
                payload=payload,
            )
        except LinkRevokedError:
            await link_revoked(message, state, store, binding, settings)
            return False
        except BotApiError as exc:
            logger.warning("record_update_failed", status=exc.status, code=exc.code)
            await state.clear()
            if exc.status == 404:
                await store.drop_receipt(message.chat.id, key)
                await card.show(message, state, texts.RECORD_GONE, None, own=own)
                return False
            await card.show(
                message,
                state,
                texts.API_UNAVAILABLE,
                keyboards.record_actions(key, method=receipt.get("method")),
                own=own,
            )
            return False
    return True


@router.callback_query(F.data.startswith(keyboards.RECORD_BACK_PREFIX))
async def back_to_record(
    callback: CallbackQuery, state: FSMContext, store: BindingStore, settings: BotSettings
) -> None:
    key = (callback.data or "").removeprefix(keyboards.RECORD_BACK_PREFIX)
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    await callback.answer()
    if await state.get_state() == RecordTime.waiting.state:
        await state.clear()
    await card.show(
        message,
        state,
        echo_text(receipt, tz=settings.tz),
        keyboards.record_actions(key, method=receipt.get("method")),
        own=True,
    )


@router.callback_query(F.data.startswith(keyboards.RECORD_DELETE_PREFIX))
async def delete_ask(callback: CallbackQuery, state: FSMContext, store: BindingStore) -> None:
    key = (callback.data or "").removeprefix(keyboards.RECORD_DELETE_PREFIX)
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    await callback.answer()
    await card.show(
        message,
        state,
        texts.RECORD_DELETE_ASK.format(summary=receipt.get("summary") or ""),
        keyboards.record_delete_confirm(key),
        own=True,
    )


@router.callback_query(F.data.startswith(keyboards.RECORD_DELETE_YES_PREFIX))
async def delete_confirmed(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Удаление мягкое: сервер ставит `deleted_at`, запись остаётся в аудите."""

    key = (callback.data or "").removeprefix(keyboards.RECORD_DELETE_YES_PREFIX)
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    binding = await _binding_for(store, message.chat.id, receipt)
    if binding is None:
        await callback.answer(texts.RECORD_CHILD_GONE, show_alert=True)
        return
    for log_id in receipt.get("log_ids", []):
        try:
            await api.delete_log(
                link_id=binding.link_id,
                secret=binding.secret,
                patient_id=binding.patient_id,
                kind=str(receipt["kind"]),
                log_id=str(log_id),
            )
        except LinkRevokedError:
            await callback.answer()
            await link_revoked(message, state, store, binding, settings)
            return
        except BotApiError as exc:
            # Уже удалённая запись — цель достигнута, а не сбой.
            if exc.status == 404:
                continue
            logger.warning("record_delete_failed", status=exc.status, code=exc.code)
            await callback.answer(texts.API_UNAVAILABLE, show_alert=True)
            return
    await callback.answer()
    await store.drop_receipt(message.chat.id, key)
    await card.show(
        message,
        state,
        texts.RECORD_DELETED.format(summary=receipt.get("summary") or ""),
        None,
        own=True,
    )


@router.callback_query(F.data.startswith(keyboards.RECORD_METHOD_PREFIX))
async def switch_ketone_method(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """«Это была моча» — поправить метод записи и запомнить его для ребёнка."""

    key = (callback.data or "").removeprefix(keyboards.RECORD_METHOD_PREFIX)
    found = await _context(callback, store, key)
    if found is None:
        return
    message, receipt = found
    current = receipt.get("method")
    value = (receipt.get("extra") or {}).get("value")
    binding = await _binding_for(store, message.chat.id, receipt)
    if receipt.get("kind") != "ketones" or current not in ("blood", "urine") or value is None:
        await callback.answer(texts.RECORD_EXPIRED, show_alert=True)
        return
    if binding is None:
        await callback.answer(texts.RECORD_CHILD_GONE, show_alert=True)
        return
    await callback.answer()
    method = "urine" if current == "blood" else "blood"
    if not await _patch_all(
        message,
        state,
        api=api,
        store=store,
        settings=settings,
        binding=binding,
        key=key,
        receipt=receipt,
        payload={"method": method},
        own=True,
    ):
        return
    receipt = receipt | {"method": method, "summary": ketones_summary(Decimal(value), method)}
    await store.put_receipt(message.chat.id, key, receipt)
    await store.set_ketone_method(message.chat.id, binding.patient_id, method)
    await card.show(
        message,
        state,
        echo_text(receipt, tz=settings.tz),
        keyboards.record_actions(key, method=method),
        own=True,
    )
