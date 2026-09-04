"""Точка входа Telegram-бота KetoCare (раздел 7 ТЗ).

Собственного доступа к БД у бота нет — только вызовы API по двухключевой схеме
(ADR-0009). Состояния FSM и секреты привязок живут в Redis: и то и другое обязано
переживать перезапуск, иначе после каждого деплоя семьи оказывались бы отвязаны
посреди начатого ввода.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import structlog
from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import (
    BotCommand,
    MenuButtonDefault,
    MenuButtonWebApp,
    TelegramObject,
    WebAppInfo,
)
from redis.asyncio import Redis

from . import texts
from .api import BotApi
from .config import BotSettings, load_settings
from .handlers import fallback, scenarios, start
from .observability import init_sentry
from .storage import BindingStore

logger = structlog.get_logger(__name__)


class DepsMiddleware(BaseMiddleware):
    """Кладёт клиент API, хранилище привязок и настройки в аргументы обработчиков.

    Глобальных объектов нет намеренно: тест подставляет свои и не трогает ни
    сеть, ни Redis. Настройки здесь же и по той же причине: шагу «когда это
    было» нужен часовой пояс семьи, а читать его из глобального объекта значит
    сделать разбор времени непроверяемым.
    """

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
        data["api"] = self._api
        data["store"] = self._store
        data["settings"] = self._settings
        return await handler(event, data)


def build_dispatcher(
    *, storage: RedisStorage, api: BotApi, store: BindingStore, settings: BotSettings
) -> Dispatcher:
    dp = Dispatcher(storage=storage)

    middleware = DepsMiddleware(api, store, settings)
    dp.message.middleware(middleware)
    dp.callback_query.middleware(middleware)

    # Порядок важен: fallback ловит всё подряд и обязан быть последним.
    dp.include_router(start.router)
    dp.include_router(scenarios.router)
    dp.include_router(fallback.router)
    return dp


#: Команды синего меню Telegram. Без них меню пустое, и родителю негде увидеть,
#: что здесь вообще есть /help.
BOT_COMMANDS = [
    BotCommand(command="start", description=texts.CMD_START_DESCRIPTION),
    BotCommand(command="help", description=texts.CMD_HELP_DESCRIPTION),
]


async def setup_bot_profile(bot: Bot, settings: BotSettings) -> None:
    """Команды и описания бота — то, что родитель видит до первого сообщения.

    Экран «Что умеет этот бот?» до /start и строка в списке чатов были пустыми.
    Вызовы идемпотентны и повторяются при каждом старте; их отказ не роняет
    бота — без описания он хуже выглядит, но работает, а вот не запуститься
    из-за косметики нельзя.
    """

    try:
        await bot.set_my_commands(BOT_COMMANDS)
        await bot.set_my_description(description=texts.BOT_DESCRIPTION)
        await bot.set_my_short_description(short_description=texts.BOT_SHORT_DESCRIPTION)
        await _setup_menu_button(bot, settings)
    except Exception as exc:  # noqa: BLE001 — косметика не должна ронять запуск
        logger.warning("bot_profile_setup_failed", reason=str(exc))


async def _setup_menu_button(bot: Bot, settings: BotSettings) -> None:
    """Mini App открывается КНОПКОЙ МЕНЮ, а не кнопкой клавиатуры.

    Разница не косметическая, она решающая. Документация Telegram:
    «initData … empty if the Mini App was launched from a keyboard button» —
    приложение, запущенное из обычной клавиатуры, подписи не получает вовсе,
    такие кнопки рассчитаны на `sendData()`. Проверено на живом стенде: клиент
    передавал `tgWebAppVersion`, `tgWebAppPlatform`, `tgWebAppThemeParams` — и
    ни одного `tgWebAppData`, поэтому вход был невозможен в принципе.

    Кнопка меню работает «exactly the same way as when using inline buttons»,
    то есть с полной подписью, и стоит постоянно слева от поля ввода — искать
    её не нужно.

    Пустой или не-https адрес возвращает кнопку по умолчанию: кнопка меню,
    ведущая в никуда, хуже отсутствующей — она занимает единственное видное
    место рядом с полем ввода.
    """

    if not settings.has_miniapp:
        await bot.set_chat_menu_button(menu_button=MenuButtonDefault())
        return

    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text=texts.BTN_APP_MENU,
            web_app=WebAppInfo(url=settings.miniapp_url.strip()),
        )
    )


async def main() -> None:
    settings = load_settings()

    # Бот падает так же молча, как воркер: у семьи это выглядит как «не
    # отвечает». Ничего не делает, пока SENTRY_DSN пуст.
    init_sentry(settings)

    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    http = httpx.AsyncClient(base_url=settings.bot_api_base_url, timeout=10.0)
    bot = Bot(token=settings.bot_token)

    dp = build_dispatcher(
        storage=RedisStorage(redis),
        api=BotApi(http, service_token=settings.bot_api_token),
        store=BindingStore(redis),
        settings=settings,
    )

    try:
        await setup_bot_profile(bot, settings)
        await dp.start_polling(bot)
    finally:
        await http.aclose()
        await bot.session.close()
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
