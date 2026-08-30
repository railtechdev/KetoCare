"""Настройки бота (раздел 12 ТЗ).

Бот не ходит в БД — только в API по сервисному токену (раздел 7 ТЗ), поэтому
`DATABASE_URL` ему не нужен, а `REDIS_URL` нужен: там живут состояния FSM и
секреты привязок.
"""

from __future__ import annotations

import sys

from pydantic import ValidationError
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


def load_settings() -> BotSettings:
    """Настройки бота или понятный отказ — но без секретов в журнале.

    `BotSettings()` при незаполненной переменной поднимает `ValidationError`, а
    он печатает `input_value` целиком — то есть **весь словарь настроек вместе с
    `bot_api_token`**. Бот при этом перезапускается по `restart: unless-stopped`,
    и сервисный токен уходит в `docker logs` снова и снова: на стенде без токена
    BotFather журнал за сутки набивается секретом, который виден любому, у кого
    есть доступ к серверу.

    Поэтому наружу выдаются только имена незаполненных полей.
    """

    try:
        return BotSettings()  # type: ignore[call-arg]
    except ValidationError as error:
        missing = ", ".join(str(item["loc"][0]).upper() for item in error.errors())
        print(
            f"Бот не запущен: не заданы переменные окружения — {missing}.\n"
            "Значения берутся из .env; полный список — .env.example, "
            "получение токена — docs/DEPLOY.md.",
            file=sys.stderr,
        )
        raise SystemExit(78) from None  # EX_CONFIG
