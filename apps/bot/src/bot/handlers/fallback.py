"""Нераспознанный ввод вне сценария (раздел 7.5 ТЗ).

Роутер подключается последним: до него доходит только то, что не разобрал ни
один сценарий.
"""

from __future__ import annotations

from aiogram import Router
from aiogram.types import Message

from .. import keyboards, texts
from ..api import BotApi
from ..storage import BindingStore
from .start import handle_bare_code, looks_like_code

router = Router(name="fallback")


@router.message()
async def unknown(message: Message, api: BotApi, store: BindingStore) -> None:
    text = (message.text or "").strip()

    # Код привязки, присланный сообщением. Проверяется до отбойника: родитель,
    # переписавший код с экрана компьютера, иначе получил бы «я умею записывать
    # данные» в ответ на ровно то, что бот и просил прислать.
    if looks_like_code(text) and await store.get(message.chat.id) is None:
        await handle_bare_code(message, api=api, store=store)
        return

    # Раздел 7.5: бот не отвечает на медицинские вопросы и не поддерживает
    # свободную беседу. Ответ один и тот же на что угодно.
    await message.answer(texts.UNKNOWN_INPUT, reply_markup=keyboards.MAIN_MENU)
