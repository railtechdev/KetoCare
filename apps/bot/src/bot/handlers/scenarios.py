"""FSM-сценарии ввода (раздел 7.3 ТЗ).

Реализованы кетоны, вес и самочувствие. Приступ не реализован намеренно: шкала
длительности из раздела 7.3 расходится со шкалой анкеты регистрации и теряет
пороги 10 и 30 минут (эпилептический статус) — вопрос 23 в
`docs/medical/OPEN_QUESTIONS.md`. Перерисовать кнопки дешевле, чем переучивать
семью, поэтому сценарий ждёт ответа медицинской команды.

Еда и лекарства идут следующим куском: им нужны меню на сегодня и список
активных препаратов, то есть чтение, а не только запись.

Общая форма каждого сценария — 2-4 шага, инлайновые кнопки, «Отмена» на каждом
шаге. Валидация чисел — только диапазон из ТЗ: интерпретировать значение бот не
должен (раздел 7.5).
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InaccessibleMessage, Message

from .. import keyboards, texts
from ..api import BotApi, BotApiError, LinkRevokedError
from ..config import BotSettings
from ..deps import require_binding, submit_log
from ..event_time import TimeError, parse_moment
from ..storage import BindingStore

logger = structlog.get_logger(__name__)

router = Router(name="scenarios")

# Диапазоны из раздела 7.3 ТЗ. Вне их бот переспрашивает, а не сохраняет.
KETONES_MIN, KETONES_MAX = Decimal("0"), Decimal("12")
WEIGHT_MIN, WEIGHT_MAX = Decimal("2"), Decimal("150")

# Ограничение поля `side_effect_logs.symptom` — String(255).
SYMPTOM_MAX_LENGTH = 255


class When(StatesGroup):
    """Общий шаг всех сценариев: когда произошло событие.

    Состояние одно на все сценарии, а не своё у каждого: шаг одинаковый, а три
    его копии однажды разошлись бы — и одна из них снова ставила бы момент
    отправки.
    """

    choice = State()
    manual = State()


class Ketones(StatesGroup):
    value = State()
    method = State()


class Weight(StatesGroup):
    value = State()


class Meal(StatesGroup):
    choice = State()


class Wellbeing(StatesGroup):
    symptom = State()
    note = State()


def _answerable(callback: CallbackQuery) -> Message | None:
    """Сообщение, в которое можно ответить.

    `callback.message` бывает `InaccessibleMessage` — Telegram отдаёт его для
    слишком старых сообщений, и метода `answer` у него нет. Проверка `is None`
    этого не ловит: тип объявлен как объединение, и ошибка вылезла бы уже у
    семьи, в чате.
    """

    message = callback.message
    # Именно исключением «недоступного», а не проверкой на `Message`: в тестах
    # обработчики вызываются с поддельным сообщением, и проверка по классу
    # молча уводила бы их в ранний возврат — то есть проверяла бы не то.
    if message is None or isinstance(message, InaccessibleMessage):
        return None
    return message


async def ask_when(
    message: Message, state: FSMContext, *, kind: str, payload: dict[str, str]
) -> None:
    """Спрашивает момент события и запоминает, что именно отправлять.

    Запись откладывается до ответа: бот ставил моментом события момент
    отправки, и вечерняя запись утреннего замера сдвигала его на десять часов —
    а по времени замеров врач судит о динамике.
    """

    await state.set_state(When.choice)
    await state.update_data(pending_kind=kind, pending_payload=payload)
    await message.answer(texts.WHEN_ASK, reply_markup=keyboards.when())


async def _submit_pending(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    occurred_at: datetime | None,
) -> None:
    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    data = await state.get_data()
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind=data["pending_kind"],
        payload=data["pending_payload"],
        occurred_at=occurred_at,
    )


@router.callback_query(When.choice, F.data == keyboards.WHEN_NOW_DATA)
async def when_now(
    callback: CallbackQuery, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    await _submit_pending(message, state, api=api, store=store, occurred_at=None)


@router.callback_query(When.choice, F.data == keyboards.WHEN_MANUAL_DATA)
async def when_manual(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    await state.set_state(When.manual)
    await message.answer(texts.WHEN_ASK_MANUAL, reply_markup=keyboards.cancel_only())


@router.message(When.manual)
async def when_typed(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    moment = parse_moment(message.text or "", now=datetime.now(UTC), tz=settings.tz)

    if isinstance(moment, TimeError):
        # Причина называется своя у каждого отказа: «неверный формат» на
        # будущее время отправило бы человека исправлять то, что и так верно.
        await message.answer(
            {
                "future": texts.WHEN_IN_FUTURE,
                "too_old": texts.WHEN_TOO_OLD,
            }.get(str(moment), texts.WHEN_BAD_FORMAT),
            reply_markup=keyboards.cancel_only(),
        )
        return

    await _submit_pending(message, state, api=api, store=store, occurred_at=moment)


def _parse_number(raw: str) -> Decimal | None:
    """Число из текста. Запятая — тоже разделитель: её набирают чаще точки.

    Decimal, а не float: значение уходит в клиническую запись, и 3.2 должно
    остаться 3.2, а не превратиться в 3.2000000000000002.
    """

    try:
        return Decimal(raw.strip().replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


# --- Отмена: одна на все сценарии (раздел 7.3) ---


@router.callback_query(F.data == keyboards.CANCEL_DATA)
async def cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    if callback.message is not None:
        await callback.message.answer(texts.CANCELLED, reply_markup=keyboards.MAIN_MENU)
    await callback.answer()


# --- Кетоны ---


@router.message(F.text == texts.BTN_KETONES)
async def ketones_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    if await require_binding(message, store) is None:
        return
    await state.set_state(Ketones.value)
    await message.answer(texts.KETONES_ASK_VALUE, reply_markup=keyboards.cancel_only())


@router.message(Ketones.value)
async def ketones_value(message: Message, state: FSMContext) -> None:
    value = _parse_number(message.text or "")
    if value is None:
        await message.answer(texts.KETONES_NOT_A_NUMBER, reply_markup=keyboards.cancel_only())
        return
    if not KETONES_MIN <= value <= KETONES_MAX:
        await message.answer(texts.KETONES_OUT_OF_RANGE, reply_markup=keyboards.cancel_only())
        return

    await state.update_data(value=str(value))
    await state.set_state(Ketones.method)
    await message.answer(texts.KETONES_ASK_METHOD, reply_markup=keyboards.ketone_methods())


@router.callback_query(Ketones.method, F.data.startswith(keyboards.KETONE_METHOD_PREFIX))
async def ketones_method(
    callback: CallbackQuery, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    method = (callback.data or "").removeprefix(keyboards.KETONE_METHOD_PREFIX)
    data = await state.get_data()
    await ask_when(
        message,
        state,
        kind="ketones",
        payload={"value": data["value"], "method": method},
    )


# --- Вес ---


@router.message(F.text == texts.BTN_WEIGHT)
async def weight_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    if await require_binding(message, store) is None:
        return
    await state.set_state(Weight.value)
    await message.answer(texts.WEIGHT_ASK_VALUE, reply_markup=keyboards.cancel_only())


@router.message(Weight.value)
async def weight_value(
    message: Message, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    value = _parse_number(message.text or "")
    if value is None:
        await message.answer(texts.WEIGHT_NOT_A_NUMBER, reply_markup=keyboards.cancel_only())
        return
    if not WEIGHT_MIN <= value <= WEIGHT_MAX:
        await message.answer(texts.WEIGHT_OUT_OF_RANGE, reply_markup=keyboards.cancel_only())
        return

    if await require_binding(message, store) is None:
        await state.clear()
        return

    await ask_when(message, state, kind="weight", payload={"weight_kg": str(value)})


# --- Еда ---
#
# Отметка «съедено» по позициям плана дня. Свободного текста нет до этапа 4:
# разбор «съел кашу с маслом» — это `POST /ai/parse`, а придуманная ботом еда
# попадёт в итоги дня наравне с настоящей.


@router.message(F.text == texts.BTN_MEAL)
async def meal_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    binding = await require_binding(message, store)
    if binding is None:
        return

    today = datetime.now(ZoneInfo(settings.tz)).date()
    try:
        menu = await api.get_menu(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            day=today,
        )
    except LinkRevokedError:
        await store.delete(message.chat.id)
        await state.clear()
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        logger.warning("menu_fetch_failed", status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    if menu is None:
        await message.answer(texts.MEAL_NO_MENU, reply_markup=keyboards.MAIN_MENU)
        return

    pending = [item for item in menu.get("items", []) if not item.get("eaten")]
    if not pending:
        await message.answer(texts.MEAL_ALL_EATEN, reply_markup=keyboards.MAIN_MENU)
        return

    await state.set_state(Meal.choice)
    await message.answer(texts.MEAL_ASK, reply_markup=keyboards.meal_items(_meal_buttons(pending)))


def _meal_buttons(items: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """Подпись кнопки: приём пищи и блюдо.

    Название берётся из снимка позиции: рецепт могли переименовать или снять с
    публикации, а показать надо то, что стоит в плане на сегодня. Снимка нет
    только у позиций, сохранённых до его появления, — там остаётся приём пищи.
    """

    return [
        (
            str(item["id"]),
            f"{texts.MEAL_SLOTS.get(item['meal_slot'], item['meal_slot'])}: "
            f"{item.get('title') or texts.MEAL_UNKNOWN_DISH}",
        )
        for item in items
    ]


@router.callback_query(Meal.choice, F.data.startswith(keyboards.MEAL_ITEM_PREFIX))
async def meal_mark(
    callback: CallbackQuery, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    item_id = (callback.data or "").removeprefix(keyboards.MEAL_ITEM_PREFIX)
    try:
        await api.mark_eaten(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            item_id=item_id,
        )
    except LinkRevokedError:
        await store.delete(message.chat.id)
        await state.clear()
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        logger.warning("meal_mark_failed", status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    await state.clear()
    await message.answer(texts.MEAL_MARKED, reply_markup=keyboards.MAIN_MENU)


# --- Самочувствие ---


@router.message(F.text == texts.BTN_WELLBEING)
async def wellbeing_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    if await require_binding(message, store) is None:
        return
    await state.set_state(Wellbeing.symptom)
    await message.answer(texts.WELLBEING_ASK_SYMPTOM, reply_markup=keyboards.cancel_only())


@router.message(Wellbeing.symptom)
async def wellbeing_symptom(message: Message, state: FSMContext) -> None:
    symptom = (message.text or "").strip()
    if not symptom:
        await message.answer(texts.WELLBEING_ASK_SYMPTOM, reply_markup=keyboards.cancel_only())
        return
    if len(symptom) > SYMPTOM_MAX_LENGTH:
        await message.answer(
            texts.WELLBEING_TOO_LONG.format(limit=SYMPTOM_MAX_LENGTH),
            reply_markup=keyboards.cancel_only(),
        )
        return

    await state.update_data(symptom=symptom)
    await state.set_state(Wellbeing.note)
    await message.answer(texts.WELLBEING_ASK_NOTE, reply_markup=keyboards.wellbeing_note())


@router.message(Wellbeing.note)
async def wellbeing_note(
    message: Message, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    await _save_wellbeing(message, state, store=store, note=(message.text or "").strip())


@router.callback_query(Wellbeing.note, F.data == keyboards.WELLBEING_SKIP_DATA)
async def wellbeing_skip_note(
    callback: CallbackQuery, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    await _save_wellbeing(message, state, store=store, note="")


async def _save_wellbeing(
    message: Message, state: FSMContext, *, store: BindingStore, note: str
) -> None:
    if await require_binding(message, store) is None:
        await state.clear()
        return

    data = await state.get_data()
    payload: dict[str, str] = {"symptom": data["symptom"]}
    if note:
        # Поле схемы называется `description`, а не `note`: сверено с
        # SideEffectLogCreate, угадывать имена полей нельзя.
        payload["description"] = note

    await ask_when(message, state, kind="side-effects", payload=payload)
