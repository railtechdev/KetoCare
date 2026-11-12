"""FSM-сценарии ввода (раздел 7.3 ТЗ, ADR-0076).

Реализованы приступ, кетоны, вес, самочувствие, лекарства и еда. Шкала
длительности приступа — та же, что в анкете регистрации (вопрос 23, ADR-0020),
число приступов в серии спрашивается отдельным шагом (вопрос 35).

**Одна запись — одно сообщение** (ADR-0076). Сценарий ведёт свою карточку
(`bot.card`): вопрос, следующий шаг и ответ «Записано ✓» — одно и то же
сообщение бота, которое он правит. Запись сохраняется сразу, с моментом
«сейчас»; другое время и удаление — кнопками под ответом
(`handlers/records.py`).

Валидация чисел — только диапазон из ТЗ: интерпретировать значение бот не
должен (раздел 7.5).

Порядок регистрации — часть поведения, и правило одно: **кнопка меню всегда
побеждает.** Все обработчики кнопок стоят раньше шагов сценариев, и каждый
старт начинает с чистого состояния.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InaccessibleMessage, Message

from .. import card, i18n, keyboards, texts
from ..api import BotApi, BotApiError, LinkRevokedError
from ..config import BotSettings
from ..deps import (
    PENDING,
    begin_scenario,
    child_label,
    link_revoked,
    named,
    retire_keyboard,
    scenario_binding,
    send_pending,
    submit_log,
)
from ..storage import Binding, BindingStore

logger = structlog.get_logger(__name__)

router = Router(name="scenarios")

# Сценарии — только в личной переписке. В группе бот молчит; `/start` в
# группе объясняет, что нужен личный чат (роутер start).
router.message.filter(F.chat.type == "private")

# Диапазоны из раздела 7.3 ТЗ. Вне их бот переспрашивает, а не сохраняет.
KETONES_MIN, KETONES_MAX = Decimal("0"), Decimal("12")
WEIGHT_MIN, WEIGHT_MAX = Decimal("2"), Decimal("150")

# Предел длительности приступа — тот же, что у API (`schemas_logs.MAX_DURATION_SEC`).
MAX_DURATION_SEC = 86_400

# Серия приступов, введённая числом (вопрос 35): 1-4 стоят кнопками.
SEIZURE_COUNT_TYPED_MIN, SEIZURE_COUNT_TYPED_MAX = 5, 100

#: Сколько типов прошлых записей стоит на первом экране «Приступа».
RECENT_SEIZURE_TYPES = 4
#: Узел ILAE 2025 «Неклассифицированный приступ» — ответ «Не знаю».
UNKNOWN_SEIZURE_REF = "4"

# Ограничения полей `side_effect_logs`: symptom — String(255), description — 2000.
SYMPTOM_MAX_LENGTH = 255
DESCRIPTION_MAX_LENGTH = 2_000


class When(StatesGroup):
    """Шаг «Когда это было?» бота до ADR-0076 — только для совместимости.

    Сценарий, начатый до выката, мог остановиться здесь (FSM живёт сутки), и
    его кнопка «Сейчас» должна сохранить запись, а не ответить «устарела».
    """

    choice = State()
    manual = State()


class Seizure(StatesGroup):
    """Приступ: тип, число, длительность (раздел 7.3 ТЗ, вопрос 35)."""

    type_choice = State()
    count = State()
    count_exact = State()
    duration = State()
    duration_exact = State()


class Ketones(StatesGroup):
    value = State()
    method = State()


class Weight(StatesGroup):
    value = State()


class Meal(StatesGroup):
    choice = State()
    #: «Написать словами» — второй путь записи еды (раздел 10.3 ТЗ).
    text = State()
    confirm = State()


class Medication(StatesGroup):
    choice = State()


class Wellbeing(StatesGroup):
    symptom = State()


def _answerable(callback: CallbackQuery) -> Message | None:
    """Сообщение, в которое можно ответить (не `InaccessibleMessage`)."""

    message = callback.message
    if message is None or isinstance(message, InaccessibleMessage):
        return None
    return message


def _format_value(value: Decimal) -> str:
    """Число для эха — с запятой: по-русски пишут 3,2, а не 3.2."""

    return str(value).replace(".", ",")


#: Число, как его набирают: цифры, одна точка или запятая, необязательный минус.
_TYPED_NUMBER = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)", re.ASCII)

#: Целое число — только ASCII-цифры.
_WHOLE_SECONDS = re.compile(r"\d+", re.ASCII)


def _parse_number(raw: str) -> Decimal | None:
    """Число из текста; запятая — тоже разделитель. «1_0», «1e1», «NaN» — не числа."""

    text = raw.strip().replace(",", ".")
    if not _TYPED_NUMBER.fullmatch(text):
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


async def _label(store: BindingStore, message: Message, binding: Binding) -> str | None:
    return await child_label(store, message.chat.id, binding)


# --- Запуск сценариев -----------------------------------------------------
#
# Кнопка меню и кнопка напоминания запускают одно и то же. Карточка сценария —
# всегда новое сообщение: у кнопки меню своего сообщения бота нет, а
# напоминание остаётся как было.


async def _start_seizure(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding | None = None,
) -> None:
    """Приступ: сначала типы прошлых записей ребёнка, «Другой» и «Не знаю».

    Справочник читается с сервера каждый раз: типы приступов ведёт
    медицинская команда, и список, застывший в коде, однажды разошёлся бы с
    тем, что видит врач в карте.
    """

    await state.clear()
    binding = await begin_scenario(message, state, store, binding)
    if binding is None:
        return

    try:
        types = await api.seizure_types(link_id=binding.link_id, secret=binding.secret)
    except LinkRevokedError:
        await link_revoked(message, state, store, binding, settings)
        return
    except BotApiError as exc:
        logger.warning("seizure_types_failed", status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    if not types:
        await message.answer(texts.SEIZURE_NO_TYPES)
        return

    try:
        recent = await api.recent_seizure_types(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            limit=RECENT_SEIZURE_TYPES,
        )
    except LinkRevokedError:
        await link_revoked(message, state, store, binding, settings)
        return
    except BotApiError as exc:
        # Прошлые типы — удобство, а не условие записи: без них — группы.
        logger.warning("recent_seizure_types_failed", status=exc.status, code=exc.code)
        recent = []

    # `name_ru`, а не `name`: так называется поле в ответе API. Перевода типов
    # на узбекский в справочнике нет — это клинический текст (ADR-0052).
    nodes = [
        [str(item["id"]), str(item["name_ru"]), str(item.get("ilae_ref") or "")] for item in types
    ]
    names = {type_id: name for type_id, name, _ in nodes}
    recent_buttons = [(type_id, names[type_id]) for type_id in recent if type_id in names][
        :RECENT_SEIZURE_TYPES
    ]
    await state.set_state(Seizure.type_choice)
    await state.update_data(
        seizure_types=nodes,
        seizure_type_names=names,
        seizure_recent=[list(pair) for pair in recent_buttons],
    )
    child = await _label(store, message, binding)
    if recent_buttons:
        await card.open_card(
            message,
            state,
            named(texts.SEIZURE_ASK_TYPE, child),
            keyboards.seizure_first(recent_buttons, unknown_id=_unknown_type(nodes)),
        )
        return
    text, markup = _seizure_groups(nodes, recent=False)
    await card.open_card(message, state, named(text, child), markup)


async def _start_ketones(
    message: Message, state: FSMContext, *, store: BindingStore, binding: Binding | None = None
) -> None:
    await state.clear()
    binding = await begin_scenario(message, state, store, binding)
    if binding is None:
        return
    await state.set_state(Ketones.value)
    await card.open_card(
        message,
        state,
        named(texts.KETONES_ASK_VALUE, await _label(store, message, binding)),
        keyboards.cancel_only(),
    )


async def _start_weight(
    message: Message, state: FSMContext, *, store: BindingStore, binding: Binding | None = None
) -> None:
    await state.clear()
    binding = await begin_scenario(message, state, store, binding)
    if binding is None:
        return
    await state.set_state(Weight.value)
    await card.open_card(
        message,
        state,
        named(texts.WEIGHT_ASK_VALUE, await _label(store, message, binding)),
        keyboards.cancel_only(),
    )


async def _start_wellbeing(
    message: Message, state: FSMContext, *, store: BindingStore, binding: Binding | None = None
) -> None:
    await state.clear()
    binding = await begin_scenario(message, state, store, binding)
    if binding is None:
        return
    await state.set_state(Wellbeing.symptom)
    await card.open_card(
        message,
        state,
        named(texts.WELLBEING_ASK_SYMPTOM, await _label(store, message, binding)),
        keyboards.cancel_only(),
    )


async def _start_medications(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding | None = None,
) -> None:
    """Лекарства на сегодня списком с галочками — одним сообщением.

    Схему терапии ведёт врач, семья по ней даёт лекарства. Прежде каждое
    лекарство отмечалось отдельно, тремя нажатиями, и «пропустили» отметить
    было нельзя вовсе — а пропуск врачу важен не меньше приёма.
    """

    await state.clear()
    binding = await begin_scenario(message, state, store, binding)
    if binding is None:
        return

    today = datetime.now(ZoneInfo(settings.tz)).date()
    try:
        items = await api.active_medications(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            day=today,
        )
    except LinkRevokedError:
        await link_revoked(message, state, store, binding, settings)
        return
    except BotApiError as exc:
        logger.warning("medications_fetch_failed", status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    if not items:
        await message.answer(texts.MEDICATION_NONE)
        return

    labels = [
        [str(item["id"]), texts.MEDICATION_DOSE.format(name=item["drug_name"], dose=item["dose"])]
        for item in items
    ]
    await state.set_state(Medication.choice)
    await state.update_data(med_items=labels, med_marked=[])
    await card.open_card(
        message,
        state,
        named(texts.MEDICATION_ASK, await _label(store, message, binding)),
        keyboards.medications(_pairs(labels), marked=[]),
    )


async def _start_meal(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding | None = None,
) -> None:
    """Меню на сегодня списком с галочками; нажатие отмечает «съедено» сразу.

    Свободный текст — отдельным путём «Написать словами» с подтверждением:
    придуманная ботом еда попала бы в итоги дня наравне с настоящей.
    """

    await state.clear()
    binding = await begin_scenario(message, state, store, binding)
    if binding is None:
        return

    items = await _fetch_menu_items(
        message, state, api=api, store=store, settings=settings, binding=binding
    )
    if items is None:
        return

    await state.set_state(Meal.choice)
    if not items:
        # Не тупик: съеденное можно описать словами.
        await card.open_card(message, state, texts.MEAL_NO_MENU, keyboards.meal_text_only())
        return
    await state.update_data(meal_items=items, meal_marked=[])
    if all(item[3] for item in items):
        await card.open_card(message, state, texts.MEAL_ALL_EATEN, keyboards.meal_text_only())
        return
    await card.open_card(
        message,
        state,
        named(texts.MEAL_ASK, await _label(store, message, binding)),
        _meal_markup(items, []),
    )


# --- Кнопки главного меню ---------------------------------------------------


@router.message(F.text.in_(i18n.variants("BTN_SEIZURE")))
async def seizure_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await _start_seizure(message, state, api=api, store=store, settings=settings)


@router.message(F.text.in_(i18n.variants("BTN_KETONES")))
async def ketones_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    await _start_ketones(message, state, store=store)


@router.message(F.text.in_(i18n.variants("BTN_WEIGHT")))
async def weight_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    await _start_weight(message, state, store=store)


@router.message(F.text.in_(i18n.variants("BTN_MEDICATION")))
async def medication_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await _start_medications(message, state, api=api, store=store, settings=settings)


@router.message(F.text.in_(i18n.variants("BTN_MEAL")))
async def meal_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await _start_meal(message, state, api=api, store=store, settings=settings)


@router.message(F.text.in_(i18n.variants("BTN_WELLBEING")))
async def wellbeing_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    await _start_wellbeing(message, state, store=store)


# --- Кнопка под напоминанием воркера (ADR-0076) -----------------------------


@router.callback_query(F.data.startswith(keyboards.REMINDER_PREFIX))
async def reminder_start(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """«Записать кетоны» под напоминанием — сценарий для ребёнка из напоминания.

    Ребёнок берётся из кнопки, а не выбранный: чат может вести двоих, а
    напоминание — про одного. Выбранного ребёнка нажатие не меняет.
    """

    message = _answerable(callback)
    kind, _, patient_hex = (
        (callback.data or "").removeprefix(keyboards.REMINDER_PREFIX).partition(":")
    )
    binding = None
    if message is not None and kind in keyboards.REMINDER_KINDS:
        binding = next(
            (b for b in await store.all(message.chat.id) if b.patient_id.hex == patient_hex),
            None,
        )
    if message is None or binding is None:
        await callback.answer(texts.RECORD_CHILD_GONE, show_alert=True)
        return
    await callback.answer()

    if kind == "ketones":
        await _start_ketones(message, state, store=store, binding=binding)
    elif kind == "weight":
        await _start_weight(message, state, store=store, binding=binding)
    elif kind == "medications":
        await _start_medications(
            message, state, api=api, store=store, settings=settings, binding=binding
        )
    else:
        await _start_wellbeing(message, state, store=store, binding=binding)


# --- Отмена и повтор: общие для всех сценариев --------------------------------


@router.callback_query(F.data == keyboards.CANCEL_DATA)
async def cancel(callback: CallbackQuery, state: FSMContext) -> None:
    if await state.get_state() is None:
        # Сценарий уже закончен: запись сохранена или отменена. «Отменено» про
        # сохранённую запись было бы неправдой.
        await retire_keyboard(callback)
        await callback.answer(texts.BUTTON_STALE, show_alert=True)
        return
    await state.clear()
    message = _answerable(callback)
    if message is not None:
        await card.show(message, state, texts.CANCELLED, None, own=True)
    await callback.answer()


@router.callback_query(F.data == keyboards.RETRY_DATA)
async def retry(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """«Повторить» после «нет связи» — та же попытка с тем же ключом (ADR-0035)."""

    message = _answerable(callback)
    if message is None or not (await state.get_data()).get(PENDING):
        await retire_keyboard(callback)
        await callback.answer(texts.BUTTON_STALE, show_alert=True)
        return
    await callback.answer()
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    await send_pending(
        message, state, api=api, store=store, binding=binding, settings=settings, own=True
    )


# --- Совместимость: шаг «Когда это было?» до ADR-0076 ----------------------


@router.callback_query(When.choice, F.data == keyboards.WHEN_NOW_DATA)
async def when_now(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    data = await state.get_data()
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind=data["pending_kind"],
        payloads=[data["pending_payload"]],
        summary=data.get("pending_summary", ""),
        settings=settings,
        own=True,
    )


# --- Кетоны ---------------------------------------------------------------


@router.message(Ketones.value)
async def ketones_value(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    value = _parse_number(message.text or "")
    if value is None:
        await card.show(message, state, texts.KETONES_NOT_A_NUMBER, keyboards.cancel_only())
        return
    if not KETONES_MIN <= value <= KETONES_MAX:
        await card.show(message, state, texts.KETONES_OUT_OF_RANGE, keyboards.cancel_only())
        return

    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    await state.update_data(value=str(value))

    # Метод помнится по ребёнку (ADR-0076): семья меряет одним прибором, и
    # вопрос «кровь или моча» при каждой записи был лишним нажатием. Эхо
    # называет метод, кнопка под ним меняет.
    method = await store.ketone_method(message.chat.id, binding.patient_id)
    if method is None:
        await state.set_state(Ketones.method)
        await card.show(message, state, texts.KETONES_ASK_METHOD, keyboards.ketone_methods())
        return
    await _save_ketones(
        message,
        state,
        api=api,
        store=store,
        settings=settings,
        binding=binding,
        value=value,
        method=method,
        own=False,
    )


@router.callback_query(Ketones.method, F.data.startswith(keyboards.KETONE_METHOD_PREFIX))
async def ketones_method(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    method = (callback.data or "").removeprefix(keyboards.KETONE_METHOD_PREFIX)
    if method not in ("blood", "urine"):
        return
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    await store.set_ketone_method(message.chat.id, binding.patient_id, method)
    value = Decimal((await state.get_data())["value"])
    await _save_ketones(
        message,
        state,
        api=api,
        store=store,
        settings=settings,
        binding=binding,
        value=value,
        method=method,
        own=True,
    )


def ketones_summary(value: Decimal, method: str) -> str:
    return texts.SUMMARY_KETONES.format(
        value=_format_value(value), method=texts.KETONE_METHOD_NAMES.get(method, method)
    )


async def _save_ketones(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding,
    value: Decimal,
    method: str,
    own: bool,
) -> None:
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="ketones",
        payloads=[{"value": str(value), "method": method}],
        summary=ketones_summary(value, method),
        settings=settings,
        own=own,
        method=method,
        extra={"value": str(value)},
    )


# --- Вес ------------------------------------------------------------------


@router.message(Weight.value)
async def weight_value(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    value = _parse_number(message.text or "")
    if value is None:
        await card.show(message, state, texts.WEIGHT_NOT_A_NUMBER, keyboards.cancel_only())
        return
    if not WEIGHT_MIN <= value <= WEIGHT_MAX:
        await card.show(message, state, texts.WEIGHT_OUT_OF_RANGE, keyboards.cancel_only())
        return

    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="weight",
        payloads=[{"weight_kg": str(value)}],
        summary=texts.SUMMARY_WEIGHT.format(value=_format_value(value)),
        settings=settings,
        own=False,
    )


# --- Самочувствие ---------------------------------------------------------


def split_wellbeing(text: str) -> tuple[str, str | None]:
    """Одно сообщение семьи → «что беспокоит» и описание.

    Прежде было два шага: короткий симптом, потом «добавить описание?». Теперь
    одно сообщение: его первая строка — то, что видно в списке дневника, а
    весь текст целиком, если он длиннее строки, — описание. Ничего из
    написанного не теряется и не переформулируется.
    """

    first = text.splitlines()[0].strip() if text.strip() else ""
    symptom = first
    if len(symptom) > SYMPTOM_MAX_LENGTH:
        symptom = symptom[: SYMPTOM_MAX_LENGTH - 1].rstrip() + "…"
    return symptom, (text if text != symptom else None)


@router.message(Wellbeing.symptom)
async def wellbeing_symptom(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    text = (message.text or "").strip()
    if not text:
        await card.show(message, state, texts.WELLBEING_ASK_SYMPTOM, keyboards.cancel_only())
        return
    if len(text) > DESCRIPTION_MAX_LENGTH:
        await card.show(
            message,
            state,
            texts.WELLBEING_TOO_LONG.format(limit=DESCRIPTION_MAX_LENGTH),
            keyboards.cancel_only(),
        )
        return

    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    symptom, description = split_wellbeing(text)
    payload: dict[str, str] = {"symptom": symptom}
    if description:
        # Поле схемы — `description` (SideEffectLogCreate).
        payload["description"] = description
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="side-effects",
        payloads=[payload],
        summary=texts.SUMMARY_WELLBEING.format(symptom=symptom),
        settings=settings,
        own=False,
    )


# --- Лекарства ------------------------------------------------------------


def _pairs(items: list[list[str]]) -> list[tuple[str, str]]:
    return [(str(item[0]), str(item[1])) for item in items]


@router.callback_query(Medication.choice, F.data.startswith(keyboards.MEDICATION_PREFIX))
async def medication_toggle(callback: CallbackQuery, state: FSMContext) -> None:
    """Галочка у лекарства — правка кнопок того же сообщения."""

    message = _answerable(callback)
    medication_id = (callback.data or "").removeprefix(keyboards.MEDICATION_PREFIX)
    data = await state.get_data()
    items: list[list[str]] = data.get("med_items", [])
    marked: list[str] = list(data.get("med_marked", []))
    await callback.answer()
    if message is None or medication_id not in {item[0] for item in items}:
        return
    if medication_id in marked:
        marked.remove(medication_id)
    else:
        marked.append(medication_id)
    await state.update_data(med_marked=marked)
    await card.show_markup(message, keyboards.medications(_pairs(items), marked=marked))


@router.callback_query(
    Medication.choice,
    F.data.in_({keyboards.MEDICATION_GIVEN_DATA, keyboards.MEDICATION_SKIPPED_DATA}),
)
async def medication_answer(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """«Дали» или «Пропустили» — про отмеченные или, если не отмечено ничего, про все.

    Каждое лекарство — своя запись дневника (`taken: true / false`): так их
    читает врач. Время — «сейчас», другое — кнопкой под ответом.
    """

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    data = await state.get_data()
    items: list[list[str]] = data.get("med_items", [])
    marked: list[str] = data.get("med_marked", [])
    chosen = [item for item in items if not marked or item[0] in marked]
    taken = callback.data == keyboards.MEDICATION_GIVEN_DATA
    template = texts.SUMMARY_MEDICATIONS_GIVEN if taken else texts.SUMMARY_MEDICATIONS_SKIPPED
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="medications",
        payloads=[{"medication_id": item[0], "taken": taken} for item in chosen],
        summary=template.format(list=", ".join(item[1] for item in chosen)),
        settings=settings,
        own=True,
    )


# --- Приступ --------------------------------------------------------------
#
# Справочник ILAE 2025 — дерево по номеру узла («3», «3.1», «3.1.2»). Узла
# «3.3» в нём нет, а «3.3.1»-«3.3.7» есть: подтипом считается ближайший
# существующий предок, а не строковый родитель.


def _refs(nodes: list[list[str]]) -> dict[str, str]:
    return {ref: type_id for type_id, _, ref in nodes if ref}


def _parent_ref(ref: str, existing: dict[str, str]) -> str | None:
    parts = ref.split(".")
    for size in range(len(parts) - 1, 0, -1):
        candidate = ".".join(parts[:size])
        if candidate in existing:
            return candidate
    return None


def seizure_children(nodes: list[list[str]], parent_ref: str | None) -> list[tuple[str, str, bool]]:
    """Прямые подтипы узла (`None` — верхний уровень): (тип, название, есть ли подтипы).

    Тип без номера классификации стоит на верхнем уровне: ответ, который
    медицинская команда завела в справочник, не должен потеряться в дереве.
    """

    existing = _refs(nodes)
    parents = {ref: _parent_ref(ref, existing) for ref in existing}
    result: list[tuple[str, str, bool]] = []
    for type_id, name, ref in nodes:
        parent = parents.get(ref) if ref else None
        if parent != parent_ref:
            continue
        has_children = bool(ref) and any(p == ref for p in parents.values())
        result.append((type_id, name, has_children))
    return result


def _unknown_type(nodes: list[list[str]]) -> str | None:
    """«Не знаю» — узел «Неклассифицированный приступ» справочника, если он есть."""

    return _refs(nodes).get(UNKNOWN_SEIZURE_REF)


def _seizure_groups(nodes: list[list[str]], *, recent: bool) -> tuple[str, Any]:
    """Верхний уровень классификации — или плоский список у справочника без номеров."""

    if not _refs(nodes):
        return texts.SEIZURE_ASK_TYPE, keyboards.seizure_types([(n[0], n[1]) for n in nodes])
    unknown = _unknown_type(nodes)
    top = [node for node in seizure_children(nodes, None) if node[0] != unknown]
    return texts.SEIZURE_ASK_GROUP, keyboards.seizure_nodes(
        top, unknown_id=unknown, back=keyboards.SEIZURE_FIRST_DATA if recent else None
    )


@router.callback_query(
    Seizure.type_choice,
    F.data.in_({keyboards.SEIZURE_OTHER_DATA, keyboards.SEIZURE_FIRST_DATA}),
)
async def seizure_other(callback: CallbackQuery, state: FSMContext) -> None:
    """«Другой» — группы классификации; «Назад» с групп — к прошлым типам."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    data = await state.get_data()
    nodes: list[list[str]] = data.get("seizure_types", [])
    recent: list[list[str]] = data.get("seizure_recent", [])
    if callback.data == keyboards.SEIZURE_FIRST_DATA and recent:
        await card.show(
            message,
            state,
            texts.SEIZURE_ASK_TYPE,
            keyboards.seizure_first(_pairs(recent), unknown_id=_unknown_type(nodes)),
            own=True,
        )
        return
    text, markup = _seizure_groups(nodes, recent=bool(recent))
    await card.show(message, state, text, markup, own=True)


@router.callback_query(Seizure.type_choice, F.data.startswith(keyboards.SEIZURE_GROUP_PREFIX))
async def seizure_group(callback: CallbackQuery, state: FSMContext) -> None:
    """Группа: сама группа как ответ («точнее не знаю») и её подтипы."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    group_id = (callback.data or "").removeprefix(keyboards.SEIZURE_GROUP_PREFIX)
    nodes: list[list[str]] = (await state.get_data()).get("seizure_types", [])
    node = next((n for n in nodes if n[0] == group_id and n[2]), None)
    if node is None:
        return
    existing = _refs(nodes)
    parent = _parent_ref(node[2], existing)
    back = (
        keyboards.SEIZURE_GROUP_PREFIX + existing[parent]
        if parent is not None
        else keyboards.SEIZURE_OTHER_DATA
    )
    await card.show(
        message,
        state,
        texts.SEIZURE_ASK_SUBTYPE.format(group=node[1]),
        keyboards.seizure_nodes(
            seizure_children(nodes, node[2]), itself=(node[0], node[1]), back=back
        ),
        own=True,
    )


@router.callback_query(Seizure.type_choice, F.data.startswith(keyboards.SEIZURE_TYPE_PREFIX))
async def seizure_type(callback: CallbackQuery, state: FSMContext) -> None:
    """Тип выбран — сколько приступов было (вопрос 35)."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    type_id = (callback.data or "").removeprefix(keyboards.SEIZURE_TYPE_PREFIX)
    names: dict[str, str] = (await state.get_data()).get("seizure_type_names", {})
    if names and type_id not in names:
        return
    await state.set_state(Seizure.count)
    await state.update_data(seizure_type_id=type_id)
    await card.show(message, state, texts.SEIZURE_ASK_COUNT, keyboards.seizure_counts(), own=True)


@router.callback_query(Seizure.count, F.data == keyboards.SEIZURE_COUNT_MORE_DATA)
async def seizure_count_more(callback: CallbackQuery, state: FSMContext) -> None:
    """«5 и больше» — число вводится руками."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    await state.set_state(Seizure.count_exact)
    await card.show(
        message, state, texts.SEIZURE_ASK_COUNT_EXACT, keyboards.cancel_only(), own=True
    )


@router.callback_query(Seizure.count, F.data.startswith(keyboards.SEIZURE_COUNT_PREFIX))
async def seizure_count(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    raw = (callback.data or "").removeprefix(keyboards.SEIZURE_COUNT_PREFIX)
    # Кнопки знают только 1-4. Иное значение — подделанный или устаревший callback.
    if not raw.isascii() or not raw.isdigit() or int(raw) not in keyboards.SEIZURE_COUNT_BUTTONS:
        # Переспросить дешевле, чем записать чужое число.
        await card.show(
            message, state, texts.SEIZURE_ASK_COUNT, keyboards.seizure_counts(), own=True
        )
        return
    await state.update_data(seizure_count=int(raw))
    await _ask_seizure_duration(message, state, api=api, store=store, settings=settings, own=True)


@router.message(Seizure.count_exact)
async def seizure_count_exact(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Серия из пяти и больше — целым числом, в пределах 5-100."""

    raw = (message.text or "").strip()
    if (
        not _WHOLE_SECONDS.fullmatch(raw)
        or not SEIZURE_COUNT_TYPED_MIN <= int(raw) <= SEIZURE_COUNT_TYPED_MAX
    ):
        await card.show(
            message,
            state,
            texts.SEIZURE_COUNT_INVALID.format(
                low=SEIZURE_COUNT_TYPED_MIN, high=SEIZURE_COUNT_TYPED_MAX
            ),
            keyboards.cancel_only(),
        )
        return
    await state.update_data(seizure_count=int(raw))
    await _ask_seizure_duration(message, state, api=api, store=store, settings=settings, own=False)


async def _ask_seizure_duration(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    own: bool,
) -> None:
    """Шкала длительности из справочника анкеты; для серии — самый долгий приступ."""

    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    try:
        options = await api.duration_options(link_id=binding.link_id, secret=binding.secret)
    except LinkRevokedError:
        await link_revoked(message, state, store, binding, settings)
        return
    except BotApiError as exc:
        logger.warning("duration_options_failed", status=exc.status, code=exc.code)
        await state.clear()
        await card.show(message, state, texts.API_UNAVAILABLE, None, own=own)
        return

    buttons = [(str(item["id"]), str(item["name_ru"])) for item in options]
    series = _seizure_count(await state.get_data()) > 1
    await state.set_state(Seizure.duration)
    await state.update_data(seizure_duration_names=dict(buttons))
    await card.show(
        message,
        state,
        texts.SEIZURE_ASK_DURATION_SERIES if series else texts.SEIZURE_ASK_DURATION,
        keyboards.seizure_durations(buttons),
        own=own,
    )


def _seizure_count(data: dict[str, Any]) -> int:
    value = data.get("seizure_count", 1)
    return value if isinstance(value, int) else 1


def format_seconds(seconds: int) -> str:
    """Длительность для эха: «10 мин», «1 мин 30 с», «45 с» — а не «600 с»."""

    minutes, rest = divmod(seconds, 60)
    if not minutes:
        return texts.SEIZURE_SAVED_EXACT_SEC.format(value=rest)
    if not rest:
        return texts.SEIZURE_SAVED_EXACT_MIN.format(value=minutes)
    return texts.SEIZURE_SAVED_EXACT_MIN_SEC.format(minutes=minutes, seconds=rest)


def _seizure_summary(data: dict[str, Any], duration: str) -> str:
    count = _seizure_count(data)
    name = data.get("seizure_type_names", {}).get(
        data["seizure_type_id"], texts.SEIZURE_UNNAMED_TYPE
    )
    if count > 1:
        return texts.SEIZURE_SAVED_SERIES.format(
            type=name, count=count, duration=texts.SEIZURE_SAVED_LONGEST.format(duration=duration)
        )
    return texts.SEIZURE_SAVED.format(type=name, duration=duration)


@router.callback_query(Seizure.duration, F.data == keyboards.SEIZURE_EXACT_DATA)
async def seizure_duration_exact_ask(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    data = await state.get_data()
    await state.set_state(Seizure.duration_exact)
    await card.show(
        message,
        state,
        texts.SEIZURE_ASK_EXACT_SERIES if _seizure_count(data) > 1 else texts.SEIZURE_ASK_EXACT,
        keyboards.cancel_only(),
        own=True,
    )


@router.callback_query(Seizure.duration, F.data.startswith(keyboards.SEIZURE_DURATION_PREFIX))
async def seizure_duration(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Интервал со слов — ссылкой на справочник, а не числом (ADR-0020)."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    option_id = (callback.data or "").removeprefix(keyboards.SEIZURE_DURATION_PREFIX)
    data = await state.get_data()
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="seizures",
        payloads=[
            {
                "seizure_type_id": data["seizure_type_id"],
                "duration_option_id": option_id,
                "count": _seizure_count(data),
            }
        ],
        summary=_seizure_summary(
            data,
            data.get("seizure_duration_names", {}).get(option_id, texts.SEIZURE_UNNAMED_DURATION),
        ),
        settings=settings,
        own=True,
    )


@router.message(Seizure.duration_exact)
async def seizure_duration_exact(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Точная длительность — целым числом секунд, в пределах суток."""

    raw = (message.text or "").strip()
    if not _WHOLE_SECONDS.fullmatch(raw) or int(raw) > MAX_DURATION_SEC:
        await card.show(
            message,
            state,
            texts.SEIZURE_EXACT_INVALID.format(limit=MAX_DURATION_SEC),
            keyboards.cancel_only(),
        )
        return
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    seconds = int(raw)
    data = await state.get_data()
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="seizures",
        payloads=[
            {
                "seizure_type_id": data["seizure_type_id"],
                "duration_sec": seconds,
                "count": _seizure_count(data),
            }
        ],
        summary=_seizure_summary(data, format_seconds(seconds)),
        settings=settings,
        own=False,
    )


# --- Еда: меню на сегодня ---------------------------------------------------

#: Позиция меню в данных сценария: [id, подпись, номер приёма, отмечена до начала].
MealItem = list[Any]


async def _fetch_menu_items(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding,
) -> list[MealItem] | None:
    """Позиции меню на сегодня; пустой список — меню нет; None — ответ уже дан."""

    today = datetime.now(ZoneInfo(settings.tz)).date()
    try:
        menu = await api.get_menu(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            day=today,
        )
    except LinkRevokedError:
        await link_revoked(message, state, store, binding, settings)
        return None
    except BotApiError as exc:
        logger.warning("menu_fetch_failed", status=exc.status, code=exc.code)
        await state.clear()
        await message.answer(texts.API_UNAVAILABLE)
        return None
    if menu is None:
        return []
    return [
        [
            str(item["id"]),
            # Название — из снимка позиции: рецепт могли переименовать.
            f"{texts.meal_name(item['meal_index'])}: {item.get('title') or texts.MEAL_UNKNOWN_DISH}",
            item.get("meal_index"),
            bool(item.get("eaten")),
        ]
        for item in menu.get("items", [])
    ]


def _meal_markup(items: list[MealItem], marked: list[str]) -> Any:
    return keyboards.meal_items(
        [
            (str(i[0]), str(i[1]), i[2] if isinstance(i[2], int) else None, bool(i[3]))
            for i in items
        ],
        marked=marked,
    )


async def _mark(
    message: Message,
    state: FSMContext,
    callback: CallbackQuery,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    item_ids: list[str],
    eaten: bool,
) -> bool:
    """Поставить или снять отметку «съедено»; False — ответ о сбое уже дан."""

    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        await callback.answer()
        return False
    for item_id in item_ids:
        try:
            await api.mark_eaten(
                link_id=binding.link_id,
                secret=binding.secret,
                patient_id=binding.patient_id,
                item_id=item_id,
                eaten=eaten,
            )
        except LinkRevokedError:
            await callback.answer()
            await link_revoked(message, state, store, binding, settings)
            return False
        except BotApiError as exc:
            logger.warning("meal_mark_failed", status=exc.status, code=exc.code)
            if exc.status in (404, 409):
                # Позиции больше нет: меню пересохранили без неё. Это не
                # «сервис недоступен» — показывается меню, какое оно теперь.
                await callback.answer()
                await _show_changed_menu(
                    message, state, api=api, store=store, settings=settings, binding=binding
                )
                return False
            await callback.answer(texts.API_UNAVAILABLE, show_alert=True)
            return False
    return True


async def _show_changed_menu(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
    binding: Binding,
) -> None:
    items = await _fetch_menu_items(
        message, state, api=api, store=store, settings=settings, binding=binding
    )
    if items is None:
        return
    data = await state.get_data()
    present = {item[0] for item in items}
    marked = [item_id for item_id in data.get("meal_marked", []) if item_id in present]
    # Отмеченное в этом сообщении остаётся его отметкой (снимаемой), прочее
    # съеденное — неактивным.
    for item in items:
        if item[0] in marked:
            item[3] = False
    await state.update_data(meal_items=items, meal_marked=marked)
    await card.show(message, state, texts.MEAL_PLAN_CHANGED, _meal_markup(items, marked), own=True)


@router.callback_query(Meal.choice, F.data.startswith(keyboards.MEAL_ITEM_PREFIX))
async def meal_toggle(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Нажатие на блюдо — отметка «съедено» сразу, галочка в том же сообщении."""

    message = _answerable(callback)
    item_id = (callback.data or "").removeprefix(keyboards.MEAL_ITEM_PREFIX)
    data = await state.get_data()
    items: list[MealItem] = data.get("meal_items", [])
    marked: list[str] = list(data.get("meal_marked", []))
    item = next((i for i in items if i[0] == item_id), None)
    if message is None or item is None or item[3]:
        await callback.answer()
        return
    eaten = item_id not in marked
    if not await _mark(
        message,
        state,
        callback,
        api=api,
        store=store,
        settings=settings,
        item_ids=[item_id],
        eaten=eaten,
    ):
        return
    if eaten:
        marked.append(item_id)
    else:
        marked.remove(item_id)
    await state.update_data(meal_marked=marked)
    await callback.answer(texts.MEAL_TOAST_MARKED if eaten else texts.MEAL_TOAST_UNMARKED)
    await card.show_markup(message, _meal_markup(items, marked))


@router.callback_query(Meal.choice, F.data.startswith(keyboards.MEAL_WHOLE_PREFIX))
async def meal_whole(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """«Приём N целиком» — все неотмеченные блюда приёма одним нажатием."""

    message = _answerable(callback)
    raw = (callback.data or "").removeprefix(keyboards.MEAL_WHOLE_PREFIX)
    data = await state.get_data()
    items: list[MealItem] = data.get("meal_items", [])
    marked: list[str] = list(data.get("meal_marked", []))
    targets = [
        item[0] for item in items if str(item[2]) == raw and not item[3] and item[0] not in marked
    ]
    if message is None or not targets:
        await callback.answer()
        return
    if not await _mark(
        message,
        state,
        callback,
        api=api,
        store=store,
        settings=settings,
        item_ids=targets,
        eaten=True,
    ):
        return
    marked.extend(targets)
    await state.update_data(meal_marked=marked)
    await callback.answer(texts.MEAL_TOAST_MARKED)
    await card.show_markup(message, _meal_markup(items, marked))


@router.callback_query(Meal.choice, F.data == keyboards.DONE_DATA)
async def meal_done(callback: CallbackQuery, state: FSMContext, store: BindingStore) -> None:
    """«Готово» — карточка становится итогом: что отмечено в этом сообщении."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    data = await state.get_data()
    marked: list[str] = data.get("meal_marked", [])
    titles = [str(item[1]) for item in data.get("meal_items", []) if item[0] in marked]
    patient = data.get("scenario_patient_id")
    await state.clear()
    if not titles:
        await card.show(message, state, texts.CANCELLED, None, own=True)
        return
    # Имя — ребёнка, про которого начата отметка, а не выбранного сейчас.
    binding = next(
        (b for b in await store.all(message.chat.id) if str(b.patient_id) == str(patient)), None
    )
    child = await child_label(store, message.chat.id, binding) if binding else None
    await card.show(
        message, state, named(texts.MEAL_DONE.format(list=", ".join(titles)), child), None, own=True
    )


# --- Еда словами (раздел 10.3 ТЗ) -----------------------------------------


@router.callback_query(Meal.choice, F.data == keyboards.MEAL_TEXT_DATA)
async def meal_text_start(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    await state.set_state(Meal.text)
    await card.show(message, state, texts.MEAL_TEXT_ASK, keyboards.cancel_only(), own=True)


@router.message(StateFilter(Meal.text, Meal.confirm))
async def meal_text_parse(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Разбор фразы. Ничего не сохраняет — показывает черновик в карточке.

    Текст на шаге подтверждения — новая попытка: родитель увидел, что разобрано
    не то, и написал иначе. Отвечать ему «выберите кнопку» было бы глухо.
    """

    text = (message.text or "").strip()
    if not text:
        await card.show(message, state, texts.MEAL_TEXT_EMPTY, keyboards.cancel_only())
        return

    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return

    await state.set_state(Meal.text)
    # «Разбираю…» — в той же карточке: разбор идёт секунды, и потом его место
    # занимает черновик.
    await card.show(message, state, texts.MEAL_TEXT_WORKING, None)

    try:
        parsed = await api.parse_text(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            text=text,
        )
    except LinkRevokedError:
        await link_revoked(message, state, store, binding, settings)
        return
    except BotApiError as exc:
        logger.warning("meal_parse_failed", status=exc.status, code=exc.code)
        answer = (
            texts.MEAL_TEXT_LIMIT if exc.code == "rate_limited" else texts.MEAL_TEXT_UNAVAILABLE
        )
        await card.show(message, state, answer, None)
        await state.clear()
        return

    items = ((parsed.get("meal") or {}).get("items")) or []
    if not items:
        question = parsed.get("clarification_needed") or texts.MEAL_TEXT_EMPTY
        await card.show(
            message,
            state,
            texts.MEAL_TEXT_CLARIFY.format(question=question),
            keyboards.cancel_only(),
        )
        return

    await state.set_state(Meal.confirm)
    await state.update_data(
        meal_text=text, meal_job_id=str(parsed["ai_job_id"]), meal_summary=_summary(items)
    )
    await card.show(message, state, _draft_text(parsed, items), keyboards.confirm())


def _draft_text(parsed: dict[str, Any], items: list[dict[str, Any]]) -> str:
    """Черновик словами родителя; «примерно» — там, где модель не уверена."""

    lines = "\n".join(
        (
            texts.MEAL_TEXT_LINE if item.get("confidence", 0) >= 1 else texts.MEAL_TEXT_LINE_GUESS
        ).format(
            name=item.get("name_ru") or texts.MEAL_UNKNOWN_DISH,
            grams=_grams(item.get("grams")),
        )
        for item in items
    )
    draft = texts.MEAL_TEXT_RESULT.format(lines=lines)
    unmatched = (parsed.get("meal") or {}).get("unmatched") or []
    if unmatched:
        draft += texts.MEAL_TEXT_UNMATCHED.format(list=", ".join(unmatched))
    return draft + texts.MEAL_TEXT_CONFIRM_HINT


def _summary(items: list[dict[str, Any]]) -> str:
    return ", ".join(
        texts.MEAL_TEXT_SUMMARY_ITEM.format(
            name=item.get("name_ru") or texts.MEAL_UNKNOWN_DISH, grams=_grams(item.get("grams"))
        )
        for item in items
    )


def _grams(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "?"
    return str(int(number)) if number == int(number) else f"{number:.1f}"


@router.callback_query(Meal.confirm, F.data == keyboards.CONFIRM_DATA)
async def meal_text_confirm(
    callback: CallbackQuery,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Подтверждение: только здесь появляется запись в дневнике.

    В API уходит идентификатор разбора, а не структура: сервер берёт её из
    своего журнала (правило 6 CLAUDE.md).
    """

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return
    binding = await scenario_binding(message, state, store, settings)
    if binding is None:
        return
    data = await state.get_data()
    job_id: str | None = data.get("meal_job_id")
    if not job_id:
        await state.clear()
        await card.show(message, state, texts.MEAL_TEXT_UNAVAILABLE, None, own=True)
        return
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="meals",
        payloads=[{"free_text": data.get("meal_text", ""), "ai_job_id": job_id}],
        summary=data.get("meal_summary", ""),
        settings=settings,
        own=True,
    )
