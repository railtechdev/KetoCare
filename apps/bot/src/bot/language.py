"""Какой язык у чата и как он меняется (ADR-0052).

Порядок источников:

1. копия в Redis, если она свежая (`LANGUAGE_TTL_S`) или чат не привязан;
2. сервер — `users.language` взрослого за привязкой; пусто — значит, человек
   не выбирал, и бот сохраняет туда умолчание из Telegram, чтобы Mini App и
   рассылки воркера говорили так же;
3. язык клиента Telegram (`language_code`): узбекский — узбекский, прочее —
   русский.

Любой сбой здесь не мешает записи в дневник: язык откатывается к умолчанию из
Telegram, а сообщение обрабатывается дальше. Язык — удобство, запись — нет.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from aiogram import BaseMiddleware, Bot
from aiogram.types import (
    BotCommand,
    BotCommandScopeChat,
    CallbackQuery,
    MenuButtonWebApp,
    Message,
    TelegramObject,
    WebAppInfo,
)

from . import i18n, texts
from .api import BotApi
from .config import BotSettings
from .storage import LANGUAGE_TTL_S, Binding, BindingStore, StoredLanguage

logger = structlog.get_logger(__name__)


def commands() -> list[BotCommand]:
    """Команды синего меню на текущем языке."""

    return [
        BotCommand(command="start", description=texts.CMD_START_DESCRIPTION),
        BotCommand(command="help", description=texts.CMD_HELP_DESCRIPTION),
        BotCommand(command="language", description=texts.CMD_LANGUAGE_DESCRIPTION),
    ]


async def resolve(
    *,
    api: BotApi,
    store: BindingStore,
    chat_id: int,
    telegram_code: str | None,
    bot: Bot | None = None,
    settings: BotSettings | None = None,
) -> i18n.Language:
    """Язык, на котором отвечать в этом чате сейчас."""

    cached = await store.language(chat_id)
    cached_language = i18n.known(cached.language) if cached is not None else None
    fallback = cached_language or i18n.from_telegram(telegram_code)

    binding = await store.get(chat_id)
    if binding is None:
        # Сервера, которому принадлежал бы выбор, ещё нет: копия — и есть выбор.
        return fallback

    fresh = (
        cached is not None
        and cached_language is not None
        and not cached.pending
        and cached.checked_at is not None
        and time.time() - cached.checked_at < LANGUAGE_TTL_S
    )
    if fresh and cached_language is not None:
        return cached_language

    try:
        if cached is not None and cached.pending and cached_language is not None:
            # Выбор, не дошедший до сервера, — отправить, а не затереть.
            await api.set_language(
                link_id=binding.link_id, secret=binding.secret, language=cached_language
            )
            server: i18n.Language | None = cached_language
        else:
            server = i18n.known(
                await api.get_language(link_id=binding.link_id, secret=binding.secret)
            )
        if server is None:
            server = fallback
            await api.set_language(link_id=binding.link_id, secret=binding.secret, language=server)
    except Exception as exc:  # noqa: BLE001 — язык не должен мешать записи
        logger.warning("language_sync_failed", reason=type(exc).__name__)
        return fallback

    await store.set_language(
        chat_id,
        StoredLanguage(
            language=server,
            explicit=cached.explicit if cached is not None else False,
            checked_at=time.time(),
        ),
    )
    if cached_language is not None and cached_language != server and bot is not None:
        # Язык сменили в Mini App — кнопка приложения и команды за ним.
        with i18n.use(server):
            await apply_chat_ui(bot, chat_id, settings)
    return server


async def choose(
    *, api: BotApi, store: BindingStore, chat_id: int, language: i18n.Language
) -> None:
    """Выбор кнопкой: в копию — сразу, на сервер — если чат привязан."""

    binding = await store.get(chat_id)
    pending = False
    if binding is not None:
        try:
            await api.set_language(
                link_id=binding.link_id, secret=binding.secret, language=language
            )
        except Exception as exc:  # noqa: BLE001 — выбор останется в копии и дойдёт позже
            logger.warning("language_save_failed", reason=type(exc).__name__)
            pending = True
    await store.set_language(
        chat_id,
        StoredLanguage(
            language=language,
            explicit=True,
            checked_at=time.time() if binding is not None else None,
            pending=pending,
        ),
    )


async def after_link(
    *,
    api: BotApi,
    store: BindingStore,
    chat_id: int,
    binding: Binding,
    server_language: str | None,
) -> i18n.Language:
    """Язык после привязки: сервер знает человека, и его слово — главное.

    Кроме одного случая: человек выбрал язык кнопкой ДО привязки, а у его
    учётной записи (заведённой раньше, в другом чате) сохранён другой. Свежий
    явный выбор сильнее старого, и он уходит на сервер.
    """

    cached = await store.language(chat_id)
    chosen = i18n.known(cached.language) if cached is not None and cached.explicit else None
    final = i18n.known(server_language) or i18n.current()
    pending = False
    if chosen is not None and chosen != final:
        final = chosen
        try:
            await api.set_language(link_id=binding.link_id, secret=binding.secret, language=final)
        except Exception as exc:  # noqa: BLE001
            logger.warning("language_save_failed", reason=type(exc).__name__)
            pending = True
    await store.set_language(
        chat_id,
        StoredLanguage(
            language=final, explicit=chosen is not None, checked_at=time.time(), pending=pending
        ),
    )
    i18n.switch(final)
    return final


async def apply_chat_ui(bot: Bot | None, chat_id: int, settings: BotSettings | None) -> None:
    """Подпись кнопки приложения и команды синего меню — на языке этого чата.

    Тексты бота говорят «кнопка «Ilova»» — кнопка обязана так и называться.
    Telegram позволяет задать её для одного чата. Сбой — не повод ронять
    ответ: кнопка останется прежней, работать она не перестанет.
    """

    if bot is None:
        return
    try:
        await bot.set_my_commands(commands(), scope=BotCommandScopeChat(chat_id=chat_id))
        if settings is not None and settings.has_miniapp:
            await bot.set_chat_menu_button(
                chat_id=chat_id,
                menu_button=MenuButtonWebApp(
                    text=texts.BTN_APP_MENU,
                    web_app=WebAppInfo(url=settings.miniapp_url.strip()),
                ),
            )
    except Exception as exc:  # noqa: BLE001 — косметика не роняет ответ
        logger.warning("chat_ui_language_failed", reason=type(exc).__name__)


class LanguageMiddleware(BaseMiddleware):
    """Кладёт язык чата в контекст на время обработки одного обновления."""

    def __init__(self, api: BotApi, store: BindingStore, settings: BotSettings) -> None:
        self._api = api
        self._store = store
        self._settings = settings

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        chat_id, code = _who(event)
        if chat_id is None:
            return await handler(event, data)
        language = await resolve(
            api=self._api,
            store=self._store,
            chat_id=chat_id,
            telegram_code=code,
            bot=data.get("bot"),
            settings=self._settings,
        )
        with i18n.use(language):
            return await handler(event, data)


def _who(event: TelegramObject) -> tuple[int | None, str | None]:
    if isinstance(event, Message):
        user = event.from_user
        return event.chat.id, user.language_code if user is not None else None
    if isinstance(event, CallbackQuery):
        message = event.message
        chat_id = message.chat.id if message is not None else event.from_user.id
        return chat_id, event.from_user.language_code
    return None, None
