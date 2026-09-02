"""ARQ-воркер KetoCare.

Задачи раздела 10.1 ТЗ подключаются по мере готовности этапов: сейчас здесь
`render_report` (раздел 15 п. 14) и ночная уборка файлов, остальные
(parse_free_text, assistant_reply, doctor_summary, content_draft)
появляются на этапе 4.

Адрес Redis берётся из `core.config.Settings` — того же места, откуда его берёт
API. Своя `BaseSettings` у воркера читала только переменные процесса и не видела
`.env`: воркер молча слушал `localhost:6379`, пока API ставил задачи в Redis из
`.env`, и очередь никогда не сходилась. Один адрес — один источник.
"""

from typing import Any

from arq import cron
from arq.connections import RedisSettings

from core.config import Settings
from core.observability import init_sentry

from .maintenance import close_stuck_ai_jobs, purge_files
from .reminders.notify import notify_family
from .reminders.task import reminders_cron
from .reports.task import render_report

_settings = Settings()  # type: ignore[call-arg]

# Воркер падает молча: у него нет ни ответа клиенту, ни экрана. Отчёт, который
# не собрался ночью, обнаруживался утром по пустой ссылке. Ничего не делает,
# пока SENTRY_DSN пуст.
init_sentry("worker")


class WorkerSettingsARQ:
    functions: list[Any] = [render_report, notify_family]
    # Уборка файлов — ночью и раз в сутки: работа дисковая, торопиться некуда,
    # а днём том занят выдачей отчётов и вложений.
    cron_jobs: list[Any] = [
        cron(purge_files, hour=3, minute=30),
        # Раз в час, а не ночью: пока строка висит в `RUNNING`, её бронь
        # занимает дневной бюджет — к вечеру помощник замолчал бы «по лимиту»
        # из-за вызова, оборвавшегося утром.
        cron(close_stuck_ai_jobs, minute={7}),
        # Каждые пять минут (раздел 10.1 ТЗ): напоминание в 07:30 должно уйти
        # в 07:30, а не в ближайший час.
        cron(reminders_cron, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
    ]
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
