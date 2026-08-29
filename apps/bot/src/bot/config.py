"""Настройки бота (раздел 12 ТЗ).

Бот не ходит в БД — только в API по сервисному токену (раздел 7 ТЗ), поэтому
`DATABASE_URL` ему не нужен, а `REDIS_URL` нужен: там живут состояния FSM и
секреты привязок.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class BotSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    bot_token: str
    bot_api_token: str

    # Адрес API. Отдельная переменная, а не сборка из WEB_ORIGIN: бот ходит в API
    # напрямую, минуя веб-сервер, и в проде это разные адреса.
    bot_api_base_url: str = "http://127.0.0.1:8001"

    # Здесь живут и состояния FSM, и секреты привязок. Память процесса не годится
    # ни для того, ни для другого: после перезапуска все семьи оказались бы
    # отвязаны и должны были бы заново просить код в кабинете.
    redis_url: str = "redis://localhost:6379/0"

    # Часовой пояс для «Сейчас» в сценариях: родитель вводит время по своим
    # часам, а сервер хранит UTC.
    tz: str = "Asia/Tashkent"
