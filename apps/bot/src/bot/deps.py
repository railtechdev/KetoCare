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
from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    CallbackQuery,
    InaccessibleMessage,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)

from . import card, keyboards, texts
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


#: Ребёнок, про которого начат сценарий, — в данных FSM (ADR-0048, ревью).
_SCENARIO_PATIENT = "scenario_patient_id"
_SCENARIO_LINK = "scenario_link_id"


async def begin_scenario(
    message: Message, state: FSMContext, store: BindingStore, binding: Binding | None = None
) -> Binding | None:
    """Привязка выбранного ребёнка — и отметка в сценарии, что он про НЕГО.

    Выбранный ребёнок чата меняется не только кнопкой «👶»: код другого
    ребёнка, присланный текстом посреди сценария, делает выбранным его, а
    aiogram обрабатывает обновления одного чата параллельно — переключение
    может обогнать отправку. Если на шаге записи брать выбранного «сейчас»,
    замер, начатый про Аню, ушёл бы Тимуру. Поэтому ребёнок фиксируется в
    момент старта, и все дальнейшие шаги берут его привязку
    (`scenario_binding`), а не выбранную.
    """

    if binding is None:
        # `binding` передаёт кнопка напоминания: оно про конкретного ребёнка,
        # и запись уходит ему, а не выбранному сейчас (ADR-0076).
        binding = await require_binding(message, store)
    if binding is not None:
        await state.update_data(
            {
                _SCENARIO_PATIENT: str(binding.patient_id),
                _SCENARIO_LINK: str(binding.link_id),
            }
        )
    return binding


async def scenario_binding(
    message: Message, state: FSMContext, store: BindingStore, settings: BotSettings
) -> Binding | None:
    """Привязка ребёнка, про которого начат сценарий, или None с объяснением.

    Ищется среди привязок чата по ребёнку, а не берётся выбранная: см.
    `begin_scenario`. Ребёнка в чате больше нет — запись не уходит никому, и
    сценарий закрывается. Привязка того же ребёнка могла смениться (новый код,
    восстановление секрета) — это тот же ребёнок, и запись уходит с её
    нынешним секретом.

    Сценарий без отметки начат до обновления бота. Тогда в чате был один
    ребёнок, и если он один и сейчас — запись про него. Детей стало больше —
    отказ: угадывать, про кого запись, нельзя.
    """

    data = await state.get_data()
    raw = data.get(_SCENARIO_PATIENT)
    bindings = await store.all(message.chat.id)
    if not bindings:
        await state.clear()
        await message.answer(texts.NOT_LINKED)
        return None

    if raw is None:
        if len(bindings) == 1:
            return bindings[0]
        await state.clear()
        await message.answer(
            texts.SCENARIO_CHILD_UNKNOWN,
            reply_markup=await menu(store, message.chat.id, settings),
        )
        return None

    for binding in bindings:
        if str(binding.patient_id) == str(raw):
            return binding

    await state.clear()
    await message.answer(
        texts.SCENARIO_CHILD_GONE, reply_markup=await menu(store, message.chat.id, settings)
    )
    return None


async def several_children(store: BindingStore, chat_id: int) -> bool:
    """Ведёт ли чат двоих детей и больше (ADR-0048)."""

    return len(await store.all(chat_id)) >= 2


async def child_label(
    store: BindingStore, chat_id: int, binding: Binding | None = None
) -> str | None:
    """Имя выбранного ребёнка — только когда чат ведёт нескольких.

    У чата одного ребёнка имени в переписке нет, как и прежде: незачем, и
    сообщения остаются такими же, какими их согласовывали. Когда детей двое,
    без имени непонятно, про кого запись, — тогда имя, но только имя, без
    фамилии (ADR-0048).
    """

    if not await several_children(store, chat_id):
        return None
    if binding is not None:
        # Шаг сценария называет ребёнка, про которого сценарий начат.
        return binding.first_name
    active = await store.get(chat_id)
    return active.first_name if active is not None else None


def named(text: str, child: str | None) -> str:
    """Сообщение с именем ребёнка над ним — когда имя нужно (см. `child_label`)."""

    return f"👶 {child}\n{text}" if child else text


async def menu(store: BindingStore, chat_id: int, settings: BotSettings) -> ReplyKeyboardMarkup:
    """Главное меню чата — с кнопкой выбора ребёнка, если детей несколько."""

    return keyboards.main_menu(settings, child=await child_label(store, chat_id))


async def link_revoked(
    message: Message,
    state: FSMContext,
    store: BindingStore,
    binding: Binding,
    settings: BotSettings | None = None,
) -> None:
    """Привязку ребёнка отозвали: забыть её, закрыть сценарий, сказать, что дальше.

    Забывается привязка ОДНОГО ребёнка: остальные дети чата живут дальше
    (ADR-0048), и семье говорится, для кого теперь идут записи. Сценарий
    закрывается — начатая запись была про ребёнка, к которому доступа больше нет.

    Детей в чате не осталось — клавиатура записей убирается
    (`ReplyKeyboardRemove`): её кнопки отвечали бы «чат не привязан», и меню,
    которое ничего не умеет, хуже отсутствующего (ADR-0076).
    """

    await state.clear()
    remaining = await store.forget(message.chat.id, binding.patient_id, binding.link_id)
    if remaining is None:
        await message.answer(texts.LINK_REVOKED, reply_markup=ReplyKeyboardRemove())
        return
    await message.answer(
        texts.LINK_REVOKED_ONE.format(revoked=binding.first_name, active=remaining.first_name),
        reply_markup=await menu(store, message.chat.id, settings) if settings else None,
    )


def when_text(occurred_at: datetime | None, *, tz: str) -> str:
    """Человеческое время для эха подтверждения.

    «Только что» — запись сохранена сразу, без выбора времени; иначе то время,
    которое семья выбрала или ввела: «сегодня в 07:30» или «29.08 в 21:00».
    """

    if occurred_at is None:
        return texts.WHEN_JUST_NOW

    zone = ZoneInfo(tz)
    local = occurred_at.astimezone(zone)
    if local.date() == datetime.now(zone).date():
        return texts.WHEN_TODAY_AT.format(time=local.strftime("%H:%M"))
    return texts.WHEN_DATE_AT.format(date=local.strftime("%d.%m"), time=local.strftime("%H:%M"))


def echo_text(receipt: dict[str, Any], *, tz: str) -> str:
    """«Записано ✓» с тем, что записано, и когда — из квитанции записи.

    Эхо, а не голое «Записано ✓»: подтверждение без содержимого не даёт
    заметить опечатку (3,2 против 32 — клиническая запись). Когда чат ведёт
    двоих, эхо называет, кому ушла запись (ADR-0048).
    """

    raw = receipt.get("occurred_at")
    moment = datetime.fromisoformat(raw) if isinstance(raw, str) else None
    when = when_text(moment, tz=tz)
    summary = str(receipt.get("summary") or "")
    child = receipt.get("child")
    if child:
        if summary:
            return texts.SAVED_FOR.format(child=child, summary=summary, when=when)
        return texts.SAVED_BARE_FOR.format(child=child)
    return texts.SAVED.format(summary=summary, when=when) if summary else texts.SAVED_BARE


#: Незаконченная запись в данных сценария (ADR-0035): ключи попыток и тела.
PENDING = "pending_write"


async def submit_log(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    binding: Binding,
    kind: str,
    payloads: list[dict[str, Any]],
    summary: str,
    settings: BotSettings,
    own: bool,
    method: str | None = None,
    extra: dict[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Сохраняет запись (или несколько — лекарства) и отвечает эхом в карточке.

    Запись сохраняется сразу, с моментом «сейчас» (ADR-0076): шаг «Когда это
    было?» стоял в каждой записи, а другое время нужно редко. Под эхом —
    «Другое время» и «Удалить запись»: поправить можно здесь же, а не только в
    приложении.

    Ключ попытки и тело живут в состоянии сценария до успешной записи:
    повтор после «нет связи» отправляет ТУ ЖЕ запись — тот же ключ и то же
    тело, байт в байт (ADR-0035). Записей несколько — помнится, какие уже
    дошли, и повтор шлёт только остальные.

    Отзыв привязки обрабатывается здесь: секрет перестал работать, значит
    запись не уйдёт никогда, и держать сценарий открытым бессмысленно.
    """

    data = await state.get_data()
    pending = data.get(PENDING)
    # Повтор — только той же записи: родитель, после отказа набравший другое
    # число, отправляет новую запись, а не прежнее тело под прежним ключом.
    same = (
        isinstance(pending, dict)
        and pending.get("kind") == kind
        and "bodies" in pending
        and pending.get("payloads") == payloads
    )
    if not same:
        moment = occurred_at or datetime.now(UTC)
        bodies = [{"occurred_at": moment.isoformat(), **payload} for payload in payloads]
        pending = {
            "kind": kind,
            "keys": [str(uuid.uuid4()) for _ in bodies],
            "bodies": bodies,
            "payloads": payloads,
            "done": [None for _ in bodies],
            "summary": summary,
            "method": method,
            "extra": extra or {},
            "occurred_at": occurred_at.isoformat() if occurred_at else None,
        }
        await state.update_data({PENDING: pending})
    await send_pending(
        message, state, api=api, store=store, binding=binding, settings=settings, own=own
    )


async def send_pending(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    binding: Binding,
    settings: BotSettings,
    own: bool,
) -> None:
    """Отправить незаконченную запись из данных сценария — первый раз или повтором."""

    pending = dict((await state.get_data()).get(PENDING) or {})
    kind = str(pending["kind"])
    keys: list[str | None] = list(pending["keys"])
    done: list[str | None] = list(pending["done"])
    for index, body in enumerate(pending["bodies"]):
        if done[index]:
            continue
        key = keys[index] or str(uuid.uuid4())
        keys[index] = key
        try:
            created = await api.create_log(
                link_id=binding.link_id,
                secret=binding.secret,
                patient_id=binding.patient_id,
                kind=kind,
                payload=dict(body),
                idempotency_key=key,
            )
        except LinkRevokedError:
            await link_revoked(message, state, store, binding, settings)
            return
        except BotApiError as exc:
            # Подробности — в лог, семье только «попробуйте ещё раз».
            logger.warning("log_submit_failed", kind=kind, status=exc.status, code=exc.code)
            # Попытка остаётся вместе с ключом — и при обрыве, и при отказе:
            # при отказе бронь ключа на сервере откатывается вместе с
            # транзакцией, а ответ 502/504 прокси или «такой же запрос ещё
            # выполняется» (409) не значит, что запись не сохранилась. Новый
            # ключ при повторе тогда завёл бы её второй раз (ревью ADR-0076).
            await state.update_data({PENDING: pending | {"keys": keys, "done": done}})
            failure = texts.NO_CONNECTION if exc.code == TRANSPORT_ERROR else texts.API_UNAVAILABLE
            saved = sum(1 for log_id in done if log_id)
            if saved:
                # Несколько лекарств: часть уже в дневнике. Без этой строки семья
                # начала бы заново и записала сохранённое второй раз.
                failure += "\n" + texts.SAVED_PARTIAL.format(done=saved, total=len(done))
            await card.show(message, state, failure, keyboards.retry(), own=own)
            return
        done[index] = str(created.get("id") or "")
        await state.update_data({PENDING: pending | {"keys": keys, "done": done}})

    several = await several_children(store, message.chat.id)
    log_ids = [log_id for log_id in done if log_id]
    method = pending.get("method")
    receipt: dict[str, Any] = {
        "kind": kind,
        "patient_id": str(binding.patient_id),
        "log_ids": log_ids,
        "summary": pending.get("summary") or "",
        "occurred_at": pending.get("occurred_at"),
        "child": binding.first_name if several else None,
        "method": method,
        "extra": pending.get("extra") or {},
    }
    key = receipt_key(log_ids)
    markup = None
    if log_ids:
        await store.put_receipt(message.chat.id, key, receipt)
        markup = keyboards.record_actions(key, method=method if isinstance(method, str) else None)
    await card.show(message, state, echo_text(receipt, tz=settings.tz), markup, own=own)
    await state.clear()


def receipt_key(log_ids: list[str]) -> str:
    """Ключ квитанции — номер первой записи без дефисов (32 знака в callback_data)."""

    for log_id in log_ids:
        try:
            return uuid.UUID(log_id).hex
        except ValueError:
            continue
    return uuid.uuid4().hex


async def retire_keyboard(callback: CallbackQuery) -> None:
    """Remove the inline buttons from the message whose button was pressed.

    Buttons of a finished step stayed live under the message: «Отмена» under a
    saved record answered «Отменено» while the record stayed in the diary.
    Telegram refuses the edit for messages older than 48 hours or already
    without buttons; that is not an error for the family.
    """

    message = callback.message
    if message is None or isinstance(message, InaccessibleMessage):
        return
    try:
        await message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        return
