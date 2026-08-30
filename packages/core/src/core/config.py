"""Конфигурация из переменных окружения (раздел 12 ТЗ)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Путь до .env считается от этого файла, а не от текущего каталога. Относительный
# ".env" работал только при запуске из корня: `make migrate` и `make makemigration`
# делают `cd packages/core`, и alembic падал на «database_url: Field required» —
# то есть схему БД нельзя было изменить документированной командой.
_REPO_ROOT = Path(__file__).resolve().parents[4]

# JWT подписывается HS256: ключ короче 32 байт слабее самого хеша (RFC 7518 §3.2).
# Токен даёт доступ к клиническим данным ребёнка, поэтому длина проверяется на старте,
# а не остаётся предупреждением в логах.
SECRET_KEY_MIN_LENGTH = 32


class Settings(BaseSettings):
    # Два пути: сначала корень репозитория (разработка), затем ".env" рядом с
    # рабочим каталогом (контейнер, где файл монтируется в WORKDIR).
    model_config = SettingsConfigDict(env_file=(_REPO_ROOT / ".env", ".env"), extra="ignore")

    database_url: str
    redis_url: str

    secret_key: Annotated[str, Field(min_length=SECRET_KEY_MIN_LENGTH)]
    bot_token: str = ""
    bot_api_token: str = ""
    # Имя бота без «@»: из него собирается deep-link t.me/<имя>?start=<код>,
    # который кабинет показывает родителю. Пусто — кабинет покажет сам код.
    bot_username: str = ""

    anthropic_api_key: str = ""
    ai_model_fast: str = ""
    ai_model_smart: str = ""
    ai_daily_budget_usd: float = 10.0
    ai_user_daily_limit: int = 30

    # Список IP обратных прокси, которым можно доверять заголовок X-Forwarded-For.
    # Пусто по умолчанию: без явной настройки XFF игнорируется и берётся адрес
    # непосредственного пира. Иначе клиент подделывает заголовок и обходит
    # ограничение частоты (ключ лимита становится произвольным), а audit_log.ip
    # заполняется значением, которое выбрал сам атакующий.
    trusted_proxy_ips: str = ""

    # Том под собранные PDF-отчёты: воркер пишет, API отдаёт по ссылке с
    # истечением (раздел 7.5 ТЗ, ADR-0008). Каталог общий у обоих процессов.
    reports_dir: str = "./var/reports"
    report_link_ttl_hours: int = 24

    web_origin: str = "http://localhost:5173"
    miniapp_origin: str = "http://localhost:5174"

    sentry_dsn: str = ""
    tz: str = "Asia/Tashkent"


@lru_cache
def get_settings() -> Settings:
    """Кешируется: значения читаются из окружения один раз, а не на каждый
    encode/decode JWT (иначе .env перечитывается с диска на каждый запрос)."""

    return Settings()  # type: ignore[call-arg]


def trusted_proxies() -> frozenset[str]:
    raw = get_settings().trusted_proxy_ips
    return frozenset(part.strip() for part in raw.split(",") if part.strip())
