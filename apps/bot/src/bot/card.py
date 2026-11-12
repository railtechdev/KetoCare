"""Одна запись — одно сообщение (ADR-0076).

Бот не правил ни одного своего сообщения: запись кетонов оставляла в чате
шесть сообщений, и через неделю в нём нельзя было найти ни одной записи.
Теперь у сценария есть «карточка» — сообщение бота, которое он ведёт от
вопроса до ответа «Записано ✓»: каждый следующий шаг заменяет текст и кнопки
в нём же.

Шаг, начатый нажатием кнопки, правит сообщение, под которым кнопка стояла.
Шаг, начатый набранным текстом, правит карточку по её номеру из данных
сценария: набранное сообщение — это сообщение человека, его бот не трогает.

Telegram отказывает в правке сообщения старше двух суток, удалённого или
неизменившегося. Неизменившееся — не ошибка (тот же текст уже на экране);
остальное — повод прислать шаг новым сообщением: потерять шаг хуже, чем
лишнее сообщение.
"""

from __future__ import annotations

from typing import Any

from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardMarkup, Message

#: Номер карточки сценария в данных FSM.
CARD_KEY = "card_message_id"


def _unchanged(error: TelegramBadRequest) -> bool:
    return "not modified" in str(error).lower()


async def open_card(
    message: Message, state: FSMContext, text: str, markup: InlineKeyboardMarkup | None
) -> None:
    """Новая карточка сценария — новым сообщением, и запомнить её номер."""

    sent = await message.answer(text, reply_markup=markup)
    message_id = getattr(sent, "message_id", None)
    if message_id is not None:
        await state.update_data({CARD_KEY: message_id})


async def show(
    message: Message,
    state: FSMContext,
    text: str,
    markup: InlineKeyboardMarkup | None = None,
    *,
    own: bool = False,
) -> None:
    """Следующий шаг сценария — в его карточке.

    `own=True` — `message` и есть карточка (шаг начат кнопкой под ней).
    Иначе `message` — набранное человеком, а карточка берётся по номеру.
    """

    if own:
        try:
            await message.edit_text(text, reply_markup=markup)
            await state.update_data({CARD_KEY: message.message_id})
            return
        except TelegramBadRequest as error:
            if _unchanged(error):
                return
        await open_card(message, state, text, markup)
        return

    card_id = (await state.get_data()).get(CARD_KEY)
    bot: Any = getattr(message, "bot", None)
    if isinstance(card_id, int) and bot is not None:
        try:
            await bot.edit_message_text(
                text=text, chat_id=message.chat.id, message_id=card_id, reply_markup=markup
            )
            return
        except TelegramBadRequest as error:
            if _unchanged(error):
                return
    await open_card(message, state, text, markup)


async def show_markup(message: Message, markup: InlineKeyboardMarkup | None) -> None:
    """Поменять только кнопки карточки — галочка в списке (Bot API `editMessageReplyMarkup`)."""

    try:
        await message.edit_reply_markup(reply_markup=markup)
    except TelegramBadRequest:
        return
