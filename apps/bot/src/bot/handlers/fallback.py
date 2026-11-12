"""Нераспознанный ввод вне сценария (раздел 7.5 ТЗ).

Роутер подключается последним: до него доходит только то, что не разобрал ни
один сценарий.
"""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from .. import keyboards, texts
from ..api import BotApi
from ..config import BotSettings
from ..deps import menu, retire_keyboard
from ..storage import BindingStore
from .start import handle_bare_code, looks_like_code

router = Router(name="fallback")

# Только личная переписка: в группе отбойник отвечал бы на каждое видимое
# сообщение и предлагал меню, каждая кнопка которого просила бы код, — а
# привязка в группах запрещена. Молчание честнее спама.
router.message.filter(F.chat.type == "private")


@router.message()
async def unknown(
    message: Message,
    state: FSMContext,
    api: BotApi,
    store: BindingStore,
    settings: BotSettings,
) -> None:
    text = (message.text or "").strip()

    # Текст на шаге, где ждут кнопку (ADR-0076). Шаги, принимающие текст, —
    # число кетонов, время записи, фраза о еде — разобраны раньше; сюда
    # доходит только набранное там, где выбор — кнопкой. Отбойник «выберите,
    # что записать» здесь скрывал бы, что начатая запись ждёт ответа, а код
    # привязки посреди записи не разбирается: восемь букв, набранные в ответ
    # на вопрос, — это ответ, а не код.
    if await state.get_state() is not None:
        await message.answer(texts.BUTTON_STEP_HINT)
        return

    # Код привязки, присланный сообщением. Проверяется до отбойника: родитель,
    # переписавший код с экрана, иначе получил бы «я умею записывать данные»
    # в ответ на ровно то, что бот и просил прислать. API ответит по существу:
    # «этот ребёнок уже здесь» — или добавит ещё одного ребёнка (ADR-0048).
    if looks_like_code(text):
        await handle_bare_code(message, state, api=api, store=store, settings=settings)
        return

    binding = await store.get(message.chat.id)
    # Непривязанному — про привязку, а не про кнопки.
    if binding is None:
        await message.answer(texts.NOT_LINKED, reply_markup=keyboards.languages())
        return

    # Раздел 7.5: бот не отвечает на медицинские вопросы и не поддерживает
    # свободную беседу.
    await message.answer(
        texts.UNKNOWN_INPUT if settings.has_miniapp else texts.UNKNOWN_INPUT_NO_APP,
        reply_markup=await menu(store, message.chat.id, settings),
    )


@router.callback_query()
async def stale_button(callback: CallbackQuery) -> None:
    """A button no scenario handles any more: its step is over.

    Without an answer Telegram kept a spinner on the button and the parent
    pressed it again. The buttons are removed so the old message stops inviting
    presses.
    """

    await retire_keyboard(callback)
    await callback.answer(texts.BUTTON_STALE, show_alert=True)
