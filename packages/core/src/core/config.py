"""Конфигурация из переменных окружения (раздел 12 ТЗ)."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str

    secret_key: str
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


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
