"""Точка входа Telegram-бота KetoCare.

Каркас этапа 1 (раздел 15 ТЗ, п.1). FSM-сценарии, привязка через /start <code>
и остальная логика раздела 7 ТЗ реализуются на этапе 3 — здесь только
структура, достаточная для запуска пустого диспетчера.
"""

import asyncio

from aiogram import Bot, Dispatcher
from pydantic_settings import BaseSettings


class BotSettings(BaseSettings):
    bot_token: str
    bot_api_token: str


dp = Dispatcher()


async def main() -> None:
    settings = BotSettings()  # type: ignore[call-arg]
    bot = Bot(token=settings.bot_token)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
