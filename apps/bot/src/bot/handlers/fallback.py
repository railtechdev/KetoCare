"""Нераспознанный ввод вне сценария (раздел 7.5 ТЗ).

Роутер подключается последним: до него доходит только то, что не разобрал ни
один сценарий.
"""

from __future__ import annotations

from aiogram import F, Router
from aiogram.types import Message

from .. import keyboards, texts
from ..api import BotApi
from ..config import BotSettings
from ..storage import BindingStore
from .start import handle_bare_code, looks_like_code

router = Router(name="fallback")

# Только личная переписка: в группе отбойник отвечал бы на каждое видимое
# сообщение и предлагал меню, каждая кнопка которого просила бы код, — а
# привязка в группах запрещена. Молчание честнее спама.
router.message.filter(F.chat.type == "private")


@router.message()
async def unknown(
    message: Message, api: BotApi, store: BindingStore, settings: BotSettings
) -> None:
    text = (message.text or "").strip()
    binding = await store.get(message.chat.id)

    # Код привязки, присланный сообщением. Проверяется до отбойника: родитель,
    # переписавший код с экрана компьютера, иначе получил бы «я умею записывать
    # данные» в ответ на ровно то, что бот и просил прислать.
    if looks_like_code(text) and binding is None:
        await handle_bare_code(message, api=api, store=store, settings=settings)
        return

    # Непривязанному — про привязку, а не про кнопки: его настоящий следующий
    # шаг — код из кабинета, и совет «выберите кнопку» привёл бы его к
    # «чат не привязан» уже после нажатия.
    if binding is None:
        await message.answer(texts.NOT_LINKED)
        return

    # Раздел 7.5: бот не отвечает на медицинские вопросы и не поддерживает
    # свободную беседу. Ответ один и тот же на что угодно — но «откройте
    # приложение 📱» обещается только там, где кнопка приложения есть.
    await message.answer(
        texts.UNKNOWN_INPUT if settings.has_miniapp else texts.UNKNOWN_INPUT_NO_APP,
        reply_markup=keyboards.main_menu(settings),
    )
