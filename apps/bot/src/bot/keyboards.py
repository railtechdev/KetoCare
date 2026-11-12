"""Клавиатуры бота (раздел 7.2-7.3 ТЗ, ADR-0076).

Цвет кнопок — поле `style` Bot API 9.4 (`danger` / `success` / `primary`):
«Приступ» красная, сохранить — зелёная, открыть приложение — синяя. Клиент,
который цветов не знает, рисует кнопку как обычно. Неактивная кнопка —
`disabled` Bot API 10.3: уже сделанное остаётся видно в списке и не нажимается.
"""

from __future__ import annotations

from collections.abc import Sequence

from aiogram.types import (
    DisabledButton,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from . import i18n, texts
from .config import BotSettings

DANGER = "danger"
SUCCESS = "success"
PRIMARY = "primary"


def main_menu(settings: BotSettings, *, child: str | None = None) -> ReplyKeyboardMarkup:
    """Главное меню (раздел 7.2 ТЗ).

    ReplyKeyboard, а не инлайновая: она всегда под рукой и не исчезает после
    нажатия; `is_persistent` (Bot API 6.4) не даёт клиенту свернуть её. Бот
    больше не присылает меню под каждым ответом — сценарий живёт в одном
    сообщении (ADR-0076), а клавиатура остаётся той, что пришла с приветствием.

    «Приступ» стоит первым, отдельной строкой и красным: это самое важное
    событие дневника, и искать его среди кнопок родителю не приходится.

    Кнопки «Приложение» здесь НЕТ, и это не упущение. Документация Telegram:
    «initData … empty if the Mini App was launched from a keyboard button» —
    приложение, открытое из обычной клавиатуры, подписи не получает вовсе и
    войти не может. Mini App живёт в кнопке меню рядом с полем ввода
    (`main._setup_menu_button`) и в инлайновых кнопках под сообщениями — там
    подпись выдаётся.

    «❓ Помощь · Yordam» — на месте прежней «🌐 Til / Язык» (аудит продукта
    12.11.2026): язык меняют раз в жизни, а справка нужна в первую неделю.
    Язык — первая кнопка справки и команда /language. Подпись двуязычная по той
    же причине, что была у кнопки языка: её обязан узнать человек, не читающий
    языка бота.

    `child` — имя выбранного ребёнка, когда чат ведёт нескольких (ADR-0048).
    """

    keyboard = [
        [KeyboardButton(text=texts.BTN_SEIZURE, style=DANGER)],
        [KeyboardButton(text=texts.BTN_KETONES), KeyboardButton(text=texts.BTN_WEIGHT)],
        [KeyboardButton(text=texts.BTN_MEAL), KeyboardButton(text=texts.BTN_MEDICATION)],
        [KeyboardButton(text=texts.BTN_WELLBEING), KeyboardButton(text=texts.BTN_HELP)],
    ]
    if child:
        keyboard.append([KeyboardButton(text=texts.BTN_CHILD.format(name=child))])

    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder=texts.MENU_PROMPT,
    )


CANCEL_DATA = "cancel"
#: Повтор записи после «нет связи» — та же попытка с тем же ключом (ADR-0035).
RETRY_DATA = "retry"
CHILD_PREFIX = "child:"
LANGUAGE_PREFIX = "lang:"


def languages() -> InlineKeyboardMarkup:
    """Языки — каждый подписан на самом себе; выбранный неактивен и отмечен.

    Без «Отмены»: выбор ничего не стирает, а сообщение с вопросом можно просто
    оставить.
    """

    active = i18n.current()
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=f"✓ {label}", disabled=DisabledButton())
                if code == active
                else InlineKeyboardButton(text=label, callback_data=f"{LANGUAGE_PREFIX}{code}")
                for code, label in i18n.LANGUAGE_LABELS.items()
            ]
        ]
    )


def children(items: list[tuple[str, str]], *, active: str) -> InlineKeyboardMarkup:
    """Кнопка на каждого ребёнка чата; выбранный помечен галочкой (ADR-0048)."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"✓ {name}" if patient_id == active else name,
                    callback_data=f"{CHILD_PREFIX}{patient_id}",
                )
            ]
            for patient_id, name in items
        ]
    )


def _cancel_row() -> list[InlineKeyboardButton]:
    # «Отмена» есть в каждом сценарии — требование раздела 7.3.
    return [InlineKeyboardButton(text=texts.BTN_CANCEL, callback_data=CANCEL_DATA)]


def cancel_only() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[_cancel_row()])


def retry() -> InlineKeyboardMarkup:
    """После «нет связи»: повторить ту же запись или отказаться от неё."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=texts.BTN_RETRY, callback_data=RETRY_DATA, style=SUCCESS)],
            _cancel_row(),
        ]
    )


def open_app(settings: BotSettings) -> InlineKeyboardButton | None:
    """Кнопка приложения под сообщением — с подписью запуска (Bot API 6.0).

    Инлайновая `web_app`-кнопка, в отличие от кнопки обычной клавиатуры,
    initData выдаёт. Работает только в личной переписке — бот и живёт только
    в ней. Без https-адреса кнопки нет: Telegram отверг бы всё сообщение.
    """

    if not settings.has_miniapp:
        return None
    return InlineKeyboardButton(
        text=texts.BTN_OPEN_APP,
        web_app=WebAppInfo(url=settings.miniapp_url.strip()),
        style=PRIMARY,
    )


# --- Справка (ADR-0076) ---

HELP_LANGUAGE_DATA = "help:lang"
HELP_FIX_DATA = "help:fix"
HELP_MORE_DATA = "help:more"
HELP_BACK_DATA = "help:back"


def help_menu(settings: BotSettings) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text=texts.BTN_LANGUAGE, callback_data=HELP_LANGUAGE_DATA)]]
    app = open_app(settings)
    if app is not None:
        rows.append([app])
    rows.append([InlineKeyboardButton(text=texts.BTN_HELP_FIX, callback_data=HELP_FIX_DATA)])
    rows.append([InlineKeyboardButton(text=texts.BTN_HELP_MORE, callback_data=HELP_MORE_DATA)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def help_back() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=texts.BTN_BACK, callback_data=HELP_BACK_DATA)]]
    )


# --- Ответ на сохранённую запись (ADR-0076) ---
#
# Запись сохраняется сразу, «сейчас», а под ответом стоят «Другое время» и
# «Удалить запись». Действие — по ключу квитанции (`BindingStore.receipt`):
# в callback_data (64 байта) не поместились бы ни ребёнок, ни список записей.

RECORD_TIME_PREFIX = "rc:t:"
RECORD_QUICK_PREFIX = "rc:q:"
RECORD_TYPE_PREFIX = "rc:i:"
RECORD_BACK_PREFIX = "rc:b:"
RECORD_DELETE_PREFIX = "rc:d:"
RECORD_DELETE_YES_PREFIX = "rc:x:"
RECORD_METHOD_PREFIX = "rc:m:"

#: Быстрые варианты времени: код в callback_data → подпись.
QUICK_15_MIN = "m15"
QUICK_HOUR = "h1"
QUICK_MORNING = "mor"
QUICK_YESTERDAY_EVENING = "yev"


def record_actions(key: str, *, method: str | None = None) -> InlineKeyboardMarkup:
    """Под ответом «Записано ✓»: поправить время, метод кетонов, удалить."""

    rows: list[list[InlineKeyboardButton]] = []
    if method in ("blood", "urine"):
        label = texts.BTN_KETONES_WAS_URINE if method == "blood" else texts.BTN_KETONES_WAS_BLOOD
        rows.append([InlineKeyboardButton(text=label, callback_data=RECORD_METHOD_PREFIX + key)])
    rows.append(
        [
            InlineKeyboardButton(text=texts.BTN_OTHER_TIME, callback_data=RECORD_TIME_PREFIX + key),
            InlineKeyboardButton(
                text=texts.BTN_DELETE_RECORD, callback_data=RECORD_DELETE_PREFIX + key
            ),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def record_times(key: str, *, morning: bool) -> InlineKeyboardMarkup:
    """Быстрые варианты времени. «Утром» — только когда утро уже наступило."""

    quick = [
        (QUICK_15_MIN, texts.BTN_TIME_15_MIN),
        (QUICK_HOUR, texts.BTN_TIME_HOUR),
        *([(QUICK_MORNING, texts.BTN_TIME_MORNING)] if morning else []),
        (QUICK_YESTERDAY_EVENING, texts.BTN_TIME_YESTERDAY_EVENING),
    ]
    buttons = [
        InlineKeyboardButton(text=label, callback_data=f"{RECORD_QUICK_PREFIX}{code}:{key}")
        for code, label in quick
    ]
    return InlineKeyboardMarkup(
        inline_keyboard=[
            buttons[:2],
            buttons[2:],
            [
                InlineKeyboardButton(
                    text=texts.BTN_TIME_TYPE, callback_data=RECORD_TYPE_PREFIX + key
                ),
                InlineKeyboardButton(text=texts.BTN_BACK, callback_data=RECORD_BACK_PREFIX + key),
            ],
        ]
    )


def record_back(key: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=texts.BTN_BACK, callback_data=RECORD_BACK_PREFIX + key)]
        ]
    )


def record_delete_confirm(key: str) -> InlineKeyboardMarkup:
    """Удаление — со вторым нажатием: из чата вернуть запись нельзя."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=texts.BTN_DELETE_YES,
                    callback_data=RECORD_DELETE_YES_PREFIX + key,
                    style=DANGER,
                ),
                InlineKeyboardButton(text=texts.BTN_BACK, callback_data=RECORD_BACK_PREFIX + key),
            ]
        ]
    )


# --- Напоминания воркера (ADR-0076) ---
#
# Воркер шлёт напоминание с кнопкой «Записать…», нажатие приходит сюда.
# Формат — `rem:<вид>:<patient_id.hex>`: ребёнок в данных, потому что чат может
# вести нескольких, а напоминание — про одного. Тот же формат собирает
# `worker.reminders.buttons`; совпадение держит тест бота.

REMINDER_PREFIX = "rem:"
REMINDER_KINDS = ("ketones", "weight", "medications", "wellbeing")


# --- Еда ---

MEAL_ITEM_PREFIX = "meal:"
MEAL_WHOLE_PREFIX = "mealall:"
DONE_DATA = "done"
#: «Написать словами» — второй путь записи еды (раздел 10.3 ТЗ).
MEAL_TEXT_DATA = "meal-text"
CONFIRM_DATA = "confirm"

MARKED = "✅ "
UNMARKED = "⬜ "


def meal_items(
    items: Sequence[tuple[str, str, int | None, bool]], *, marked: Sequence[str]
) -> InlineKeyboardMarkup:
    """Меню на сегодня списком с галочками — одно сообщение на всю отметку.

    `items` — (позиция, подпись, номер приёма, отмечено ли до начала
    сценария). Отмеченное раньше стоит неактивной кнопкой: его видно, но
    снять отметку отсюда нельзя — её мог поставить второй взрослый, и снимать
    чужую отметку по случайному нажатию незачем (снять можно в приложении).
    Нажатие на свою отметку в этом же сообщении её снимает: ошибочное нажатие
    иначе осталось бы в данных.

    «Приём N целиком» — для приёма, где неотмеченных блюд два и больше.
    Выход — «Готово», если что-то отмечено, иначе «Отмена».
    """

    rows: list[list[InlineKeyboardButton]] = []
    open_by_meal: dict[int, int] = {}
    for item_id, title, meal_index, eaten_before in items:
        if eaten_before:
            rows.append([InlineKeyboardButton(text=f"✓ {title}", disabled=DisabledButton())])
            continue
        mark = MARKED if item_id in marked else UNMARKED
        rows.append(
            [InlineKeyboardButton(text=mark + title, callback_data=MEAL_ITEM_PREFIX + item_id)]
        )
        if item_id not in marked and isinstance(meal_index, int):
            open_by_meal[meal_index] = open_by_meal.get(meal_index, 0) + 1
    for meal_index, open_count in sorted(open_by_meal.items()):
        if open_count >= 2:
            rows.append(
                [
                    InlineKeyboardButton(
                        text=texts.BTN_MEAL_WHOLE.format(meal=texts.meal_name(meal_index)),
                        callback_data=f"{MEAL_WHOLE_PREFIX}{meal_index}",
                    )
                ]
            )
    rows.append([InlineKeyboardButton(text=texts.BTN_MEAL_TEXT, callback_data=MEAL_TEXT_DATA)])
    rows.append(
        [InlineKeyboardButton(text=texts.BTN_DONE, callback_data=DONE_DATA, style=SUCCESS)]
        if marked
        else _cancel_row()
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def meal_text_only() -> InlineKeyboardMarkup:
    """Когда плана на сегодня нет вовсе или всё уже отмечено."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=texts.BTN_MEAL_TEXT, callback_data=MEAL_TEXT_DATA)],
            _cancel_row(),
        ]
    )


def confirm() -> InlineKeyboardMarkup:
    """Подтверждение разбора: ничего не сохранено, пока не нажата эта кнопка."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=texts.BTN_CONFIRM, callback_data=CONFIRM_DATA, style=SUCCESS
                )
            ],
            _cancel_row(),
        ]
    )


# --- Приступ ---

SEIZURE_TYPE_PREFIX = "stype:"
#: Группа классификации: открыть её подтипы.
SEIZURE_GROUP_PREFIX = "sgrp:"
#: «Другой» — к группам классификации.
SEIZURE_OTHER_DATA = "sother"
#: «Назад» с групп — к типам прошлых записей.
SEIZURE_FIRST_DATA = "sfirst"
SEIZURE_DURATION_PREFIX = "sdur:"
#: «Ввести точно» — требование ТЗ 7.3: у кого секундомер был, тот вводит число.
SEIZURE_EXACT_DATA = "sdur-exact"


def seizure_first(recent: list[tuple[str, str]], *, unknown_id: str | None) -> InlineKeyboardMarkup:
    """Первый экран: типы прошлых записей ребёнка, «Другой», «Не знаю».

    Справочник ILAE 2025 — двадцать пять узлов, и столбец из них уводил
    «Отмену» на двадцать шестую строку (аудит продукта 12.11.2026). Прошлые
    типы — потому что у ребёнка на терапии приступы обычно одних и тех же
    типов. «Не знаю» — узел «Неклассифицированный приступ» самого справочника,
    а не значение бота: без такого узла кнопки нет.
    """

    rows = [
        [InlineKeyboardButton(text=title, callback_data=SEIZURE_TYPE_PREFIX + type_id)]
        for type_id, title in recent
    ]
    extra = [InlineKeyboardButton(text=texts.BTN_SEIZURE_OTHER, callback_data=SEIZURE_OTHER_DATA)]
    if unknown_id is not None:
        extra.append(
            InlineKeyboardButton(
                text=texts.BTN_SEIZURE_UNKNOWN, callback_data=SEIZURE_TYPE_PREFIX + unknown_id
            )
        )
    rows.append(extra)
    rows.append(_cancel_row())
    return InlineKeyboardMarkup(inline_keyboard=rows)


def seizure_nodes(
    nodes: list[tuple[str, str, bool]],
    *,
    itself: tuple[str, str] | None = None,
    unknown_id: str | None = None,
    back: str | None = None,
) -> InlineKeyboardMarkup:
    """Узлы классификации: группа открывает подтипы, лист — выбирается.

    `nodes` — (тип, подпись, есть ли подтипы). `itself` — сама группа как
    ответ («Фокальный приступ, точнее не знаю»): родитель может знать группу
    и не знать подтипа, и выбирать за него подтип нельзя. `back` — куда
    ведёт «Назад» (callback_data).
    """

    rows: list[list[InlineKeyboardButton]] = []
    if itself is not None:
        type_id, title = itself
        rows.append(
            [
                InlineKeyboardButton(
                    text=texts.SEIZURE_GROUP_ITSELF.format(name=title),
                    callback_data=SEIZURE_TYPE_PREFIX + type_id,
                )
            ]
        )
    for type_id, title, has_children in nodes:
        prefix = SEIZURE_GROUP_PREFIX if has_children else SEIZURE_TYPE_PREFIX
        label = f"{title} ›" if has_children else title
        rows.append([InlineKeyboardButton(text=label, callback_data=prefix + type_id)])
    if unknown_id is not None:
        rows.append(
            [
                InlineKeyboardButton(
                    text=texts.BTN_SEIZURE_UNKNOWN, callback_data=SEIZURE_TYPE_PREFIX + unknown_id
                )
            ]
        )
    last = []
    if back is not None:
        last.append(InlineKeyboardButton(text=texts.BTN_BACK, callback_data=back))
    last.extend(_cancel_row())
    rows.append(last)
    return InlineKeyboardMarkup(inline_keyboard=rows)


def seizure_types(items: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    """Плоский список — для справочника без номеров классификации.

    Список приходит с сервера и здесь не дополняется: типы приступов ведёт
    медицинская команда, и «прочее», добавленное ботом, оказалось бы
    значением, которого нет ни в кабинете, ни в отчёте.
    """

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=title, callback_data=f"{SEIZURE_TYPE_PREFIX}{item_id}")]
            for item_id, title in items
        ]
        + [_cancel_row()]
    )


def seizure_durations(items: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    """Шкала длительности из справочника плюс «Ввести точно»."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=title, callback_data=f"{SEIZURE_DURATION_PREFIX}{item_id}")]
            for item_id, title in items
        ]
        + [[InlineKeyboardButton(text=texts.BTN_SEIZURE_EXACT, callback_data=SEIZURE_EXACT_DATA)]]
        + [_cancel_row()]
    )


SEIZURE_COUNT_PREFIX = "scount:"
#: «5 и больше» — дальше число вводится руками.
SEIZURE_COUNT_MORE_DATA = "scount-more"
#: Сколько приступов предлагается кнопками. Пятый и дальше — вводом.
SEIZURE_COUNT_BUTTONS = (1, 2, 3, 4)


def seizure_counts() -> InlineKeyboardMarkup:
    """Сколько приступов было: 1-4 кнопками, «5 и больше» — числом."""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=str(n), callback_data=f"{SEIZURE_COUNT_PREFIX}{n}")
                for n in SEIZURE_COUNT_BUTTONS
            ],
            [
                InlineKeyboardButton(
                    text=texts.BTN_SEIZURE_COUNT_MORE, callback_data=SEIZURE_COUNT_MORE_DATA
                )
            ],
            _cancel_row(),
        ]
    )


# --- Лекарства ---

MEDICATION_PREFIX = "med:"
MEDICATION_GIVEN_DATA = "med-given"
MEDICATION_SKIPPED_DATA = "med-skipped"


def medications(items: list[tuple[str, str]], *, marked: Sequence[str]) -> InlineKeyboardMarkup:
    """Лекарства на сегодня списком с галочками и два ответа под ними.

    Ничего не отмечено — ответ про все сразу («Дали все»): у большинства
    семей схема даётся целиком, и это одно нажатие. Отмечено — про
    отмеченные. Подпись кнопки называет, к чему она относится, — угадывать
    не приходится.
    """

    rows = [
        [
            InlineKeyboardButton(
                text=(MARKED if med_id in marked else UNMARKED) + title,
                callback_data=MEDICATION_PREFIX + med_id,
            )
        ]
        for med_id, title in items
    ]
    count = len(marked)
    given = (
        texts.BTN_MEDICATION_GIVEN.format(count=count) if count else texts.BTN_MEDICATION_GIVEN_ALL
    )
    skipped = (
        texts.BTN_MEDICATION_SKIPPED.format(count=count)
        if count
        else texts.BTN_MEDICATION_SKIPPED_ALL
    )
    rows.append(
        [InlineKeyboardButton(text=given, callback_data=MEDICATION_GIVEN_DATA, style=SUCCESS)]
    )
    rows.append([InlineKeyboardButton(text=skipped, callback_data=MEDICATION_SKIPPED_DATA)])
    rows.append(_cancel_row())
    return InlineKeyboardMarkup(inline_keyboard=rows)


# --- Кетоны ---

KETONE_METHOD_PREFIX = "ketone_method:"


def ketone_methods() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=texts.KETONES_METHOD_BLOOD, callback_data=f"{KETONE_METHOD_PREFIX}blood"
                ),
                InlineKeyboardButton(
                    text=texts.KETONES_METHOD_URINE, callback_data=f"{KETONE_METHOD_PREFIX}urine"
                ),
            ],
            _cancel_row(),
        ]
    )


# --- Совместимость с ботом до ADR-0076 ---
#
# Сценарий, начатый до выката, мог остановиться на шаге «Когда это было?» —
# FSM живёт в Redis сутки. Его кнопку «Сейчас» бот ещё понимает.
WHEN_NOW_DATA = "when:now"
