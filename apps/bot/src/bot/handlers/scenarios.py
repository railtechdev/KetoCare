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

from decimal import Decimal, InvalidOperation

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from .. import keyboards, texts
from ..api import BotApi
from ..deps import require_binding, submit_log
from ..storage import BindingStore

router = Router(name="scenarios")

# Диапазоны из раздела 7.3 ТЗ. Вне их бот переспрашивает, а не сохраняет.
KETONES_MIN, KETONES_MAX = Decimal("0"), Decimal("12")
WEIGHT_MIN, WEIGHT_MAX = Decimal("2"), Decimal("150")

# Ограничение поля `side_effect_logs.symptom` — String(255).
SYMPTOM_MAX_LENGTH = 255


class Ketones(StatesGroup):
    value = State()
    method = State()


class Weight(StatesGroup):
    value = State()


class Wellbeing(StatesGroup):
    symptom = State()
    note = State()


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
    if callback.message is None:
        return

    binding = await require_binding(callback.message, store)
    if binding is None:
        await state.clear()
        return

    method = (callback.data or "").removeprefix(keyboards.KETONE_METHOD_PREFIX)
    data = await state.get_data()
    await submit_log(
        callback.message,
        state,
        api=api,
        store=store,
        binding=binding,
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

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="weight",
        payload={"weight_kg": str(value)},
    )


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
    await _save_wellbeing(message, state, api=api, store=store, note=(message.text or "").strip())


@router.callback_query(Wellbeing.note, F.data == keyboards.WELLBEING_SKIP_DATA)
async def wellbeing_skip_note(
    callback: CallbackQuery, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    await callback.answer()
    if callback.message is None:
        return
    await _save_wellbeing(callback.message, state, api=api, store=store, note="")


async def _save_wellbeing(
    message: Message, state: FSMContext, *, api: BotApi, store: BindingStore, note: str
) -> None:
    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    data = await state.get_data()
    payload: dict[str, str] = {"symptom": data["symptom"]}
    if note:
        # Поле схемы называется `description`, а не `note`: сверено с
        # SideEffectLogCreate, угадывать имена полей нельзя.
        payload["description"] = note

    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="side-effects",
        payload=payload,
    )
