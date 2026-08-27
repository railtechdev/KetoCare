"""Конфигурация из переменных окружения (раздел 12 ТЗ)."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# JWT подписывается HS256: ключ короче 32 байт слабее самого хеша (RFC 7518 §3.2).
# Токен даёт доступ к клиническим данным ребёнка, поэтому длина проверяется на старте,
# а не остаётся предупреждением в логах.
SECRET_KEY_MIN_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str

    secret_key: Annotated[str, Field(min_length=SECRET_KEY_MIN_LENGTH)]
    bot_token: str = ""
    bot_api_token: str = ""

    anthropic_api_key: str = ""
    ai_model_fast: str = ""
    ai_model_smart: str = ""
    ai_daily_budget_usd: float = 10.0
    ai_user_daily_limit: int = 30

    web_origin: str = "http://localhost:5173"
    miniapp_origin: str = "http://localhost:5174"

    sentry_dsn: str = ""
    tz: str = "Asia/Tashkent"


@lru_cache
def get_settings() -> Settings:
    """Кешируется: значения читаются из окружения один раз, а не на каждый
    encode/decode JWT (иначе .env перечитывается с диска на каждый запрос)."""

    return Settings()  # type: ignore[call-arg]
