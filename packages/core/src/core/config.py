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

    # Каталог вложений: фото рецептов и документы пациентов (ADR-0004).
    #
    # Вне webroot и раздаётся только ручкой: вложение пациента — клинические
    # данные, и прямая раздача статики обошла бы проверку доступа.
    #
    # Том обязан попадать в резервное копирование: pg_dump сохранит строки
    # таблицы, но не байты файлов, а выписка из стационара — единственный
    # экземпляр документа (ADR-0013).
    attachments_dir: str = "./var/attachments"

    # Куда `core.tools.erase_patient` кладёт архив перед удалением (раздел 11 ТЗ).
    #
    # Отдельный том, а не подкаталог отчётов: у отчётов есть срок жизни и уборка,
    # а этот архив — единственный след стёртой истории болезни. И обязательно
    # том: каталог внутри контейнера исчезает вместе с ним при первом же деплое,
    # то есть «экспорт перед удалением» существовал бы только на бумаге.
    erased_dir: str = "./var/erased"

    # Сколько всего вложений можно держать на одного пациента, мегабайт.
    #
    # Предел на файл (10 МБ) один диск не защищает: сотня документов от одной
    # семьи заполнит том так же надёжно, как один огромный файл. На пред-проде
    # это 40 ГБ на всё вместе с базой и образами, и упереться в них означает
    # положить продукт целиком, а не только загрузку.
    #
    # Сто мегабайт — это порядка двадцати сканов или фотографий выписки: для
    # ведения ребёнка с запасом, для заливки диска мало. Значение вынесено в
    # настройки, потому что на сервере клиента диск будет другим.
    attachment_quota_mb: int = 100

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
