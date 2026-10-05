"""Клавиатуры бота (раздел 7.2-7.3 ТЗ)."""

from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from . import i18n, texts
from .config import BotSettings


def main_menu(settings: BotSettings, *, child: str | None = None) -> ReplyKeyboardMarkup:
    """Главное меню (раздел 7.2 ТЗ).

    ReplyKeyboard, а не инлайновая: она всегда под рукой и не исчезает после
    нажатия.

    Кнопка «Приложение» появляется, только если Mini App куда-то выложен.
    Telegram принимает в `web_app` исключительно https, и кнопка с пустым или
    http-адресом — это не «ничего не произойдёт», а ошибка отправки всего
    сообщения: меню не пришло бы вовсе. Пока адреса нет, кнопки просто нет —
    так же, как её не было до появления Mini App.

    «Приступ» стоит первым и отдельной строкой: это самое важное событие
    дневника, и искать его среди четырёх кнопок родителю не приходится.

    Кнопки «Приложение» здесь НЕТ, и это не упущение. Документация Telegram:
    «initData … empty if the Mini App was launched from a keyboard button» —
    приложение, открытое из обычной клавиатуры, подписи не получает вовсе и
    войти не может. Проверено на живом стенде: клиент передавал
    `tgWebAppVersion`, `tgWebAppPlatform`, `tgWebAppThemeParams` и ни одного
    `tgWebAppData`. Mini App живёт в кнопке меню рядом с полем ввода
    (`main._setup_menu_button`) — там подпись выдаётся.

    `child` — имя выбранного ребёнка, когда чат ведёт нескольких (ADR-0048).
    Тогда последней строкой стоит «👶 Ребёнок: Аня»: кнопка и показывает, чей
    дневник ведётся, и открывает выбор. У чата одного ребёнка её нет — меню
    остаётся тем, к которому семья привыкла.
    """

    keyboard = [
        [KeyboardButton(text=texts.BTN_SEIZURE)],
        [KeyboardButton(text=texts.BTN_KETONES), KeyboardButton(text=texts.BTN_WEIGHT)],
        [KeyboardButton(text=texts.BTN_MEAL), KeyboardButton(text=texts.BTN_MEDICATION)],
        # «🌐 Til / Язык» — в каждом меню и на обоих языках сразу: человеку,
        # который не читает языка бота, кнопка обязана быть узнаваема (ADR-0052).
        [KeyboardButton(text=texts.BTN_WELLBEING), KeyboardButton(text=texts.BTN_LANGUAGE)],
    ]
    if child:
        keyboard.append([KeyboardButton(text=texts.BTN_CHILD.format(name=child))])

    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True,
        input_field_placeholder=texts.MENU_PROMPT,
    )


CANCEL_DATA = "cancel"
CHILD_PREFIX = "child:"
LANGUAGE_PREFIX = "lang:"


def languages() -> InlineKeyboardMarkup:
    """Языки — каждый подписан на самом себе, выбранный отмечен галочкой.

    Без «Отмены»: выбор ничего не стирает, а сообщение с вопросом можно просто
    оставить — меню под ним прежнее.
    """

    active = i18n.current()
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"✓ {label}" if code == active else label,
                    callback_data=f"{LANGUAGE_PREFIX}{code}",
                )
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
    # «Отмена» есть в каждом сценарии — требование раздела 7.3. Из шага без выхода
    # родитель вылезает только перезапуском бота, а на руках у него ребёнок.
    return [InlineKeyboardButton(text=texts.BTN_CANCEL, callback_data=CANCEL_DATA)]


def cancel_only() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[_cancel_row()])


MEAL_ITEM_PREFIX = "meal:"
DONE_DATA = "done"
#: «Написать словами» — второй путь записи еды (раздел 10.3 ТЗ).
MEAL_TEXT_DATA = "meal-text"
CONFIRM_DATA = "confirm"


def meal_items(items: list[tuple[str, str]], *, marked_any: bool = False) -> InlineKeyboardMarkup:
    """Кнопка на каждую несъеденную позицию плюс выход из серии.

    По кнопке на позицию, а не ввод номера: у родителя ребёнок на руках, и
    «напишите цифру» — это лишний шаг там, где хватает одного нажатия.

    Выход называется по-разному: пока ничего не отмечено — «Отмена», после
    первой отметки — «Готово». Ответить «Отменено.» человеку, который только
    что отметил два блюда, значит заставить его гадать, не отменились ли они.
    """

    exit_button = (
        [InlineKeyboardButton(text=texts.BTN_DONE, callback_data=DONE_DATA)]
        if marked_any
        else _cancel_row()
    )
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=title, callback_data=f"{MEAL_ITEM_PREFIX}{item_id}")]
            for item_id, title in items
        ]
        # Ниже списка, а не выше: съеденное по плану — обычный случай, а словами
        # описывают то, что от плана отклонилось.
        + [[InlineKeyboardButton(text=texts.BTN_MEAL_TEXT, callback_data=MEAL_TEXT_DATA)]]
        + [exit_button]
    )


def meal_text_only() -> InlineKeyboardMarkup:
    """Когда плана на сегодня нет вовсе.

    Раньше отсюда не вело ничего: «меню не составлено» — и всё. Родитель,
    который уже покормил ребёнка, оставался с этим один.
    """

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
            [InlineKeyboardButton(text=texts.BTN_CONFIRM, callback_data=CONFIRM_DATA)],
            _cancel_row(),
        ]
    )


SEIZURE_TYPE_PREFIX = "stype:"
SEIZURE_DURATION_PREFIX = "sdur:"
#: «Ввести точно» — требование ТЗ 7.3: у кого секундомер был, тот вводит число.
SEIZURE_EXACT_DATA = "sdur-exact"


def seizure_types(items: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    """Кнопка на каждый тип приступа из справочника.

    Список приходит с сервера и здесь не дополняется: типы приступов ведёт
    медицинская команда, и «прочее», добавленное ботом, оказалось бы значением,
    которого нет ни в кабинете, ни в отчёте.
    """

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=title, callback_data=f"{SEIZURE_TYPE_PREFIX}{item_id}")]
            for item_id, title in items
        ]
        + [_cancel_row()]
    )


def seizure_durations(items: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    """Шкала длительности из справочника плюс «Ввести точно».

    По кнопке на вариант, а не свободный ввод: родитель отвечает сразу после
    приступа, и «сколько это было в секундах» — вопрос, на который у него чаще
    всего нет ответа. Кто засекал — вводит число.
    """

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=title, callback_data=f"{SEIZURE_DURATION_PREFIX}{item_id}")]
            for item_id, title in items
        ]
        + [[InlineKeyboardButton(text=texts.BTN_SEIZURE_EXACT, callback_data=SEIZURE_EXACT_DATA)]]
        + [_cancel_row()]
    )


SEIZURE_COUNT_PREFIX = "scount:"
#: «5 и больше» — дальше число вводится руками: кнопок на каждое число не
#: напасёшься, а серия из пяти и больше встречается реже, чем один-два.
SEIZURE_COUNT_MORE_DATA = "scount-more"
#: Сколько приступов предлагается кнопками. Пятый и дальше — вводом.
SEIZURE_COUNT_BUTTONS = (1, 2, 3, 4)


def seizure_counts() -> InlineKeyboardMarkup:
    """Сколько приступов было: 1-4 кнопками, «5 и больше» — числом.

    Одной строкой: четыре коротких числа помещаются в ширину телефона, а
    столбик из пяти кнопок прятал бы «Отмену» под сгиб.
    """

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


MEDICATION_PREFIX = "med:"


def medications(items: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    """Кнопка на каждый препарат схемы.

    Списком, а не вводом названия: препарат называется так, как его записал
    врач, и любая опечатка семьи сделала бы запись не сопоставимой со схемой.
    """

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=title, callback_data=f"{MEDICATION_PREFIX}{med_id}")]
            for med_id, title in items
        ]
        + [_cancel_row()]
    )


WHEN_NOW_DATA = "when:now"
WHEN_MANUAL_DATA = "when:manual"


def when() -> InlineKeyboardMarkup:
    """«Сейчас» или «Указать время».

    «Сейчас» первым и одной кнопкой: в большинстве записей замер только что
    сделали, и лишний шаг там, где ребёнок на руках, — это несделанная запись.
    """

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=texts.BTN_WHEN_NOW, callback_data=WHEN_NOW_DATA),
                InlineKeyboardButton(text=texts.BTN_WHEN_MANUAL, callback_data=WHEN_MANUAL_DATA),
            ],
            _cancel_row(),
        ]
    )


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


WELLBEING_SKIP_DATA = "wellbeing_skip"


def wellbeing_note() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=texts.WELLBEING_SKIP, callback_data=WELLBEING_SKIP_DATA)],
            _cancel_row(),
        ]
    )
