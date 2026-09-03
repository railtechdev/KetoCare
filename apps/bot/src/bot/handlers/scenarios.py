"""FSM-сценарии ввода (раздел 7.3 ТЗ).

Реализованы кетоны, вес, самочувствие, лекарства и еда. Приступ не реализован
намеренно: шкала длительности из раздела 7.3 расходится со шкалой анкеты
регистрации и теряет пороги 10 и 30 минут (эпилептический статус) — вопрос 23 в
`docs/medical/OPEN_QUESTIONS.md`. Перерисовать кнопки дешевле, чем переучивать
семью, поэтому сценарий ждёт ответа медицинской команды. Из меню кнопка убрана,
а нажатие оставшейся на устройстве старой кнопки отвечает, где записать приступ
сейчас (`seizure_not_here`).

Общая форма каждого сценария — 2-4 шага, инлайновые кнопки, «Отмена» на каждом
шаге. Валидация чисел — только диапазон из ТЗ: интерпретировать значение бот не
должен (раздел 7.5).

Порядок регистрации — часть поведения, и правило одно: **кнопка меню всегда
побеждает.** Все обработчики кнопок стоят раньше шагов сценариев, и каждый
старт начинает с чистого состояния. Родитель не знает слова «FSM»: если он
посреди ввода кетонов нажал «⚖️ Вес», он хочет записать вес — а не услышать
«нужно число». До этого правила поведение зависело от места обработчика в
файле: одна и та же кнопка в одном шаге переключала сценарий, в другом
получала отказ.
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

# Сценарии — только в личной переписке. В группе бот отвечал отбойником на
# каждое видимое сообщение и предлагал меню, каждая кнопка которого просила
# «пришлите код», хотя привязка в группах запрещена. Молчание честнее спама;
# `/start` в группе по-прежнему объясняет, что нужен личный чат (роутер start).
router.message.filter(F.chat.type == "private")

# Диапазоны из раздела 7.3 ТЗ. Вне их бот переспрашивает, а не сохраняет.
KETONES_MIN, KETONES_MAX = Decimal("0"), Decimal("12")
WEIGHT_MIN, WEIGHT_MAX = Decimal("2"), Decimal("150")

# Предел длительности приступа — тот же, что у API (`schemas_logs.MAX_DURATION_SEC`):
# сутки. Бот не решает, какая длительность правдоподобна (раздел 7.5 ТЗ), он
# проверяет только то, что введено число.
MAX_DURATION_SEC = 86_400

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


class Seizure(StatesGroup):
    """Приступ (раздел 7.3 ТЗ).

    Три шага плюс общий «когда»: тип из справочника, длительность из шкалы
    анкеты (или точное число, если засекали), время. Комментария здесь нет
    намеренно — ТЗ помечает его необязательным, а лишний вопрос человеку,
    который только что видел приступ у ребёнка, стоит дороже, чем даёт: описать
    подробности он может в кабинете.
    """

    type_choice = State()
    duration = State()
    duration_exact = State()


class Ketones(StatesGroup):
    value = State()
    method = State()


class Weight(StatesGroup):
    value = State()


class Meal(StatesGroup):
    choice = State()
    #: «Написать словами» — второй путь записи еды (раздел 10.3 ТЗ). Отдельные
    #: состояния, потому что и вопрос, и разбор здесь другие: по плану бот
    #: отмечает готовое, а здесь — предлагает черновик на подтверждение.
    text = State()
    confirm = State()


class Medication(StatesGroup):
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


def _format_value(value: Decimal) -> str:
    """Число для эха — с запятой: по-русски пишут 3,2, а не 3.2."""

    return str(value).replace(".", ",")


def _parse_number(raw: str) -> Decimal | None:
    """Число из текста. Запятая — тоже разделитель: её набирают чаще точки.

    Decimal, а не float: значение уходит в клиническую запись, и 3.2 должно
    остаться 3.2, а не превратиться в 3.2000000000000002.
    """

    try:
        return Decimal(raw.strip().replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


# --- Запуск сценариев: кнопки меню --------------------------------------
#
# Все стартовые обработчики зарегистрированы РАНЬШЕ шагов и начинают с
# `state.clear()`: нажатие кнопки меню посреди незаконченного ввода — это
# смена намерения, а не ошибка формата.


@router.message(F.text == texts.BTN_SEIZURE)
async def seizure_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Приступ: тип из справочника (раздел 7.3 ТЗ).

    Справочник читается с сервера каждый раз, а не хранится у бота: типы
    приступов ведёт медицинская команда, и список, застывший в коде, однажды
    разошёлся бы с тем, что видит врач в карте.
    """

    await state.clear()
    binding = await require_binding(message, store)
    if binding is None:
        return

    try:
        types = await api.seizure_types(link_id=binding.link_id, secret=binding.secret)
    except LinkRevokedError:
        await store.delete(message.chat.id)
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        logger.warning("seizure_types_failed", status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    if not types:
        # Пустой справочник — не «попробуйте позже»: сам по себе он не
        # наполнится, и родителю нужно другое действие, а не повтор.
        await message.answer(texts.SEIZURE_NO_TYPES, reply_markup=keyboards.main_menu(settings))
        return

    buttons = [(str(item["id"]), str(item["name"])) for item in types]
    await state.set_state(Seizure.type_choice)
    await state.update_data(seizure_type_names=dict(buttons))
    await message.answer(texts.SEIZURE_ASK_TYPE, reply_markup=keyboards.seizure_types(buttons))


@router.message(F.text == texts.BTN_KETONES)
async def ketones_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    await state.clear()
    if await require_binding(message, store) is None:
        return
    await state.set_state(Ketones.value)
    await message.answer(texts.KETONES_ASK_VALUE, reply_markup=keyboards.cancel_only())


@router.message(F.text == texts.BTN_WEIGHT)
async def weight_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    await state.clear()
    if await require_binding(message, store) is None:
        return
    await state.set_state(Weight.value)
    await message.answer(texts.WEIGHT_ASK_VALUE, reply_markup=keyboards.cancel_only())


@router.message(F.text == texts.BTN_MEDICATION)
async def medication_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    # Схему терапии ведёт врач в карте, семья по ней даёт препараты.
    await state.clear()
    binding = await require_binding(message, store)
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
        await store.delete(message.chat.id)
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        logger.warning("medications_fetch_failed", status=exc.status, code=exc.code)
        await message.answer(texts.API_UNAVAILABLE)
        return

    if not items:
        await message.answer(texts.MEDICATION_NONE, reply_markup=keyboards.main_menu(settings))
        return

    labels = {
        str(item["id"]): texts.MEDICATION_DOSE.format(name=item["drug_name"], dose=item["dose"])
        for item in items
    }
    await state.set_state(Medication.choice)
    # Подписи запоминаются: в нажатии придёт только идентификатор, а эхо
    # подтверждения обязано назвать препарат — иначе после трёх «Записано ✓»
    # подряд не вспомнить, что уже отмечено.
    await state.update_data(med_labels=labels)
    await message.answer(
        texts.MEDICATION_ASK,
        reply_markup=keyboards.medications(list(labels.items())),
    )


@router.message(F.text == texts.BTN_MEAL)
async def meal_start(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    # Отметка «съедено» по позициям плана дня. Свободного текста нет до этапа
    # 4: разбор «съел кашу с маслом» — это `POST /ai/parse`, а придуманная
    # ботом еда попадёт в итоги дня наравне с настоящей.
    await state.clear()
    binding = await require_binding(message, store)
    if binding is None:
        return

    pending = await _fetch_pending_meals(message, state, api=api, store=store, settings=settings)
    if pending is None:
        return

    if not pending:
        # Тоже не тупик: съесть могли и то, чего в плане не было.
        await state.set_state(Meal.choice)
        await message.answer(texts.MEAL_ALL_EATEN, reply_markup=keyboards.meal_text_only())
        return

    await state.set_state(Meal.choice)
    await state.update_data(meal_labels=dict(pending))
    await message.answer(texts.MEAL_ASK, reply_markup=keyboards.meal_items(pending))


@router.message(F.text == texts.BTN_WELLBEING)
async def wellbeing_start(message: Message, state: FSMContext, store: BindingStore) -> None:
    await state.clear()
    if await require_binding(message, store) is None:
        return
    await state.set_state(Wellbeing.symptom)
    await message.answer(texts.WELLBEING_ASK_SYMPTOM, reply_markup=keyboards.cancel_only())


# --- Отмена: одна на все сценарии (раздел 7.3) ---


@router.callback_query(F.data == keyboards.CANCEL_DATA)
async def cancel(callback: CallbackQuery, state: FSMContext, settings: BotSettings) -> None:
    await state.clear()
    message = _answerable(callback)
    if message is not None:
        await message.answer(texts.CANCELLED, reply_markup=keyboards.main_menu(settings))
    await callback.answer()


# --- Когда это было: общий шаг перед отправкой ---


async def ask_when(
    message: Message, state: FSMContext, *, kind: str, payload: dict[str, Any], summary: str
) -> None:
    """Спрашивает момент события и запоминает, что именно отправлять.

    Запись откладывается до ответа: бот ставил моментом события момент
    отправки, и вечерняя запись утреннего замера сдвигала его на десять часов —
    а по времени замеров врач судит о динамике. `summary` — готовая строка для
    эха подтверждения: к моменту отправки сценарий уже забыт, и собрать её
    больше некому.
    """

    await state.set_state(When.choice)
    await state.update_data(pending_kind=kind, pending_payload=payload, pending_summary=summary)
    await message.answer(texts.WHEN_ASK, reply_markup=keyboards.when())


async def _submit_pending(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
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
        # .get, а не []: состояние FSM живёт в Redis и переживает выкат. Семья,
        # дошедшая до шага «когда» на прежней версии, нажмёт «Сейчас» уже на
        # новой — и в её сохранённых данных ключа summary нет. KeyError здесь
        # молча терял бы клиническую запись; без эха запись важнее эха.
        summary=data.get("pending_summary", ""),
        settings=settings,
        occurred_at=occurred_at,
    )


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
    await _submit_pending(message, state, api=api, store=store, settings=settings, occurred_at=None)


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

    await _submit_pending(
        message, state, api=api, store=store, settings=settings, occurred_at=moment
    )


# --- Кетоны: шаги ---


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
        summary=texts.SUMMARY_KETONES.format(
            value=_format_value(Decimal(data["value"])),
            method=texts.KETONE_METHOD_NAMES.get(method, method),
        ),
    )


# --- Вес: шаги ---


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

    await ask_when(
        message,
        state,
        kind="weight",
        payload={"weight_kg": str(value)},
        summary=texts.SUMMARY_WEIGHT.format(value=_format_value(value)),
    )


# --- Лекарства: шаги ---


@router.callback_query(Medication.choice, F.data.startswith(keyboards.MEDICATION_PREFIX))
async def medication_choice(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    medication_id = (callback.data or "").removeprefix(keyboards.MEDICATION_PREFIX)
    data = await state.get_data()
    labels: dict[str, str] = data.get("med_labels", {})
    # Время спрашивается тем же шагом, что и у замеров: приём препарата часто
    # отмечают позже, чем он был, а по времени приёма врач судит о схеме.
    await ask_when(
        message,
        state,
        kind="medications",
        payload={"medication_id": medication_id, "taken": True},
        summary=labels.get(medication_id, texts.MEDICATION_ASK),
    )


# --- Приступ: шаги ---


@router.callback_query(Seizure.type_choice, F.data.startswith(keyboards.SEIZURE_TYPE_PREFIX))
async def seizure_type(
    callback: CallbackQuery, state: FSMContext, api: BotApi, store: BindingStore
) -> None:
    """Тип выбран — спрашиваем длительность по шкале анкеты."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    type_id = (callback.data or "").removeprefix(keyboards.SEIZURE_TYPE_PREFIX)

    try:
        options = await api.duration_options(link_id=binding.link_id, secret=binding.secret)
    except LinkRevokedError:
        await store.delete(message.chat.id)
        await state.clear()
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        logger.warning("duration_options_failed", status=exc.status, code=exc.code)
        await state.clear()
        await message.answer(texts.API_UNAVAILABLE)
        return

    buttons = [(str(item["id"]), str(item["name_ru"])) for item in options]
    await state.set_state(Seizure.duration)
    await state.update_data(seizure_type_id=type_id, seizure_duration_names=dict(buttons))
    await message.answer(
        texts.SEIZURE_ASK_DURATION, reply_markup=keyboards.seizure_durations(buttons)
    )


@router.callback_query(Seizure.duration, F.data == keyboards.SEIZURE_EXACT_DATA)
async def seizure_duration_exact_ask(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    await state.set_state(Seizure.duration_exact)
    await message.answer(texts.SEIZURE_ASK_EXACT, reply_markup=keyboards.cancel_only())


@router.callback_query(Seizure.duration, F.data.startswith(keyboards.SEIZURE_DURATION_PREFIX))
async def seizure_duration(callback: CallbackQuery, state: FSMContext) -> None:
    """Интервал со слов — ссылкой на справочник, а не числом.

    Пересчитать «от 10 до 30 минут» в секунды нельзя ни нижней границей, ни
    серединой: получилось бы число, неотличимое от засечённого секундомером, а
    по нему врач судит о течении болезни (ADR-0020).
    """

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    option_id = (callback.data or "").removeprefix(keyboards.SEIZURE_DURATION_PREFIX)
    data = await state.get_data()
    await ask_when(
        message,
        state,
        kind="seizures",
        payload={
            "seizure_type_id": data["seizure_type_id"],
            "duration_option_id": option_id,
        },
        summary=texts.SEIZURE_SAVED.format(
            type=data.get("seizure_type_names", {}).get(data["seizure_type_id"], "приступ"),
            duration=data.get("seizure_duration_names", {}).get(option_id, "длительность указана"),
        ),
    )


@router.message(Seizure.duration_exact)
async def seizure_duration_exact(message: Message, state: FSMContext) -> None:
    """Точная длительность — целым числом секунд.

    Диапазон — тот же, что у API (сутки): бот не решает, какая длительность
    правдоподобна, это дело медицинской команды. Он проверяет лишь то, что
    введено число, — раздел 7.5 ТЗ прямо запрещает боту интерпретировать
    значения.
    """

    raw = (message.text or "").strip()
    if not raw.isdigit() or int(raw) > MAX_DURATION_SEC:
        await message.answer(
            texts.SEIZURE_EXACT_INVALID.format(limit=MAX_DURATION_SEC),
            reply_markup=keyboards.cancel_only(),
        )
        return

    seconds = int(raw)
    data = await state.get_data()
    await ask_when(
        message,
        state,
        kind="seizures",
        payload={"seizure_type_id": data["seizure_type_id"], "duration_sec": seconds},
        summary=texts.SEIZURE_SAVED.format(
            type=data.get("seizure_type_names", {}).get(data["seizure_type_id"], "приступ"),
            duration=texts.SEIZURE_SAVED_EXACT_SEC.format(value=seconds),
        ),
    )


# --- Еда: шаги ---


async def _fetch_pending_meals(
    message: Message,
    state: FSMContext,
    *,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> list[tuple[str, str]] | None:
    """Неотмеченные позиции плана на сегодня, или None при отказе.

    None означает, что ответ семье уже отправлен (нет меню, отозвана привязка,
    сбой API) и продолжать сценарий не с чем. Пустой список — план есть и весь
    отмечен.
    """

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return None

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
        return None
    except BotApiError as exc:
        logger.warning("menu_fetch_failed", status=exc.status, code=exc.code)
        await state.clear()
        await message.answer(texts.API_UNAVAILABLE)
        return None

    if menu is None:
        # Не тупик: съеденное можно описать словами. Раньше отсюда не вело
        # ничего, и родитель, уже покормивший ребёнка, оставался один.
        await state.set_state(Meal.choice)
        await message.answer(texts.MEAL_NO_MENU, reply_markup=keyboards.meal_text_only())
        return None

    return _meal_buttons([item for item in menu.get("items", []) if not item.get("eaten")])


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

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    item_id = (callback.data or "").removeprefix(keyboards.MEAL_ITEM_PREFIX)
    data = await state.get_data()
    marked_title: str = data.get("meal_labels", {}).get(item_id, texts.MEAL_UNKNOWN_DISH)
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

    # После отметки — остаток плана, а не выход в меню: завтрак из двух блюд
    # должен быть двумя нажатиями подряд, а не двумя заходами через меню.
    # Список берётся заново с сервера: второй родитель мог отметить своё из
    # приложения, и показывать ему уже съеденное значило бы предложить съесть
    # дважды.
    pending = await _fetch_pending_meals(message, state, api=api, store=store, settings=settings)
    if pending is None:
        return

    if not pending:
        await state.clear()
        await message.answer(
            texts.MEAL_MARKED_LAST.format(title=marked_title),
            reply_markup=keyboards.main_menu(settings),
        )
        return

    await state.update_data(meal_labels=dict(pending))
    await message.answer(
        texts.MEAL_MARKED_MORE.format(title=marked_title),
        reply_markup=keyboards.meal_items(pending, marked_any=True),
    )


@router.callback_query(Meal.choice, F.data == keyboards.MEAL_TEXT_DATA)
async def meal_text_start(callback: CallbackQuery, state: FSMContext) -> None:
    """«Написать словами» — переход ко второму пути записи еды."""

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    await state.set_state(Meal.text)
    await message.answer(texts.MEAL_TEXT_ASK, reply_markup=keyboards.cancel_only())


@router.message(Meal.text)
async def meal_text_parse(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    """Разбор фразы. Ничего не сохраняет — показывает черновик.

    Запись появится только после «Подтвердить» (правило 6 CLAUDE.md): разбор —
    это предположение модели о том, что съел ребёнок, а по нему считается
    кетосоотношение.
    """

    text = (message.text or "").strip()
    if not text:
        await message.answer(texts.MEAL_TEXT_EMPTY, reply_markup=keyboards.cancel_only())
        return

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    await message.answer(texts.MEAL_TEXT_WORKING)

    try:
        parsed = await api.parse_text(
            link_id=binding.link_id,
            secret=binding.secret,
            patient_id=binding.patient_id,
            text=text,
        )
    except LinkRevokedError:
        await store.delete(message.chat.id)
        await state.clear()
        await message.answer(texts.LINK_REVOKED)
        return
    except BotApiError as exc:
        logger.warning("meal_parse_failed", status=exc.status, code=exc.code)
        await state.clear()
        # Предел и бюджет — это «на сегодня хватит», а не «сломалось»: ответы
        # разные, потому что разное и следующее действие человека.
        answer = (
            texts.MEAL_TEXT_LIMIT if exc.code == "rate_limited" else texts.MEAL_TEXT_UNAVAILABLE
        )
        await message.answer(answer, reply_markup=keyboards.main_menu(settings))
        return

    items = ((parsed.get("meal") or {}).get("items")) or []
    if not items:
        # Вопрос модели родителю — или наш, если она не спросила. Состояние
        # остаётся: он допишет и пришлёт снова, не начиная сценарий заново.
        question = parsed.get("clarification_needed") or texts.MEAL_TEXT_EMPTY
        await message.answer(
            texts.MEAL_TEXT_CLARIFY.format(question=question),
            reply_markup=keyboards.cancel_only(),
        )
        return

    await state.set_state(Meal.confirm)
    await state.update_data(
        meal_text=text,
        meal_job_id=str(parsed["ai_job_id"]),
        # Эхо для подтверждения собирается здесь: на шаге записи разбора уже
        # нет, а «Записано ✓» без содержимого не даёт заметить, что принято
        # не то (общее правило подтверждений — `deps.submit_log`).
        meal_summary=_summary(items),
    )
    await message.answer(_draft_text(parsed, items), reply_markup=keyboards.confirm())


def _draft_text(parsed: dict[str, Any], items: list[dict[str, Any]]) -> str:
    """Черновик словами родителя, а не идентификаторами.

    Граммовка со слов — оценка, и «примерно» стоит там, где модель сама
    сказала, что не уверена (`confidence < 1`): родитель должен видеть, что
    именно ему предлагают принять на веру.
    """

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
        # Названное, но не найденное — самое опасное место: без этой строки
        # родитель решил бы, что записан весь приём пищи целиком.
        draft += texts.MEAL_TEXT_UNMATCHED.format(list=", ".join(unmatched))
    return draft + texts.MEAL_TEXT_CONFIRM_HINT


def _summary(items: list[dict[str, Any]]) -> str:
    """Состав одной строкой — для подтверждения записи."""

    return ", ".join(
        f"{item.get('name_ru') or texts.MEAL_UNKNOWN_DISH} {_grams(item.get('grams'))} г"
        for item in items
    )


def _grams(value: Any) -> str:
    """Целые граммы — без хвоста: «30 г», а не «30.0 г»."""

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

    В API уходит идентификатор разбора, а не разобранная структура: сервер
    берёт её из своего журнала. Иначе бот мог бы прислать под видом разбора
    что угодно — и это были бы клинические данные, которых никто не видел.
    """

    await callback.answer()
    message = _answerable(callback)
    if message is None:
        return

    binding = await require_binding(message, store)
    if binding is None:
        await state.clear()
        return

    data = await state.get_data()
    job_id: str | None = data.get("meal_job_id")
    if not job_id:
        await state.clear()
        await message.answer(
            texts.MEAL_TEXT_UNAVAILABLE, reply_markup=keyboards.main_menu(settings)
        )
        return

    # Момент — «сейчас»: родитель пишет сразу после кормления, и лишний шаг
    # «когда» здесь стоил бы больше, чем даёт (в отметке «съедено» его тоже нет).
    await submit_log(
        message,
        state,
        api=api,
        store=store,
        binding=binding,
        kind="meals",
        payload={"free_text": data.get("meal_text", ""), "ai_job_id": job_id},
        summary=data.get("meal_summary", ""),
        settings=settings,
    )


@router.callback_query(Meal.choice, F.data == keyboards.DONE_DATA)
async def meal_done(callback: CallbackQuery, state: FSMContext, settings: BotSettings) -> None:
    """Выход из серии отметок. «Готово», а не «Отмена»: отметки уже сохранены,
    и ответ «Отменено.» заставил бы гадать, не отменились ли они."""

    await state.clear()
    message = _answerable(callback)
    if message is not None:
        await message.answer(texts.MENU_PROMPT, reply_markup=keyboards.main_menu(settings))
    await callback.answer()


# --- Самочувствие: шаги ---


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

    await ask_when(
        message,
        state,
        kind="side-effects",
        payload=payload,
        summary=texts.SUMMARY_WELLBEING.format(symptom=data["symptom"]),
    )
