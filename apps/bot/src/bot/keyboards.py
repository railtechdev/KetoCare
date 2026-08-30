"""Клавиатуры бота (раздел 7.2-7.3 ТЗ)."""

from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from . import texts

# Главное меню — ReplyKeyboard, как требует раздел 7.2: оно всегда под рукой и не
# исчезает после нажатия, в отличие от инлайновой клавиатуры.
MAIN_MENU = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text=texts.BTN_SEIZURE), KeyboardButton(text=texts.BTN_KETONES)],
        [KeyboardButton(text=texts.BTN_WEIGHT), KeyboardButton(text=texts.BTN_MEAL)],
        [KeyboardButton(text=texts.BTN_MEDICATION), KeyboardButton(text=texts.BTN_WELLBEING)],
        [KeyboardButton(text=texts.BTN_APP)],
    ],
    resize_keyboard=True,
    input_field_placeholder=texts.MENU_PROMPT,
)

CANCEL_DATA = "cancel"


def _cancel_row() -> list[InlineKeyboardButton]:
    # «Отмена» есть в каждом сценарии — требование раздела 7.3. Из шага без выхода
    # родитель вылезает только перезапуском бота, а на руках у него ребёнок.
    return [InlineKeyboardButton(text=texts.BTN_CANCEL, callback_data=CANCEL_DATA)]


def cancel_only() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[_cancel_row()])


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
