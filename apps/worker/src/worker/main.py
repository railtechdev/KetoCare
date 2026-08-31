"""ARQ-воркер KetoCare.

Задачи раздела 10.1 ТЗ подключаются по мере готовности этапов: сейчас здесь
`render_report` (раздел 15 п. 14) и ночная уборка файлов, остальные
(parse_free_text, assistant_reply, doctor_summary, notify_family,
reminders_cron, content_draft) появляются на этапах 3-4.

Адрес Redis берётся из `core.config.Settings` — того же места, откуда его берёт
API. Своя `BaseSettings` у воркера читала только переменные процесса и не видела
`.env`: воркер молча слушал `localhost:6379`, пока API ставил задачи в Redis из
`.env`, и очередь никогда не сходилась. Один адрес — один источник.
"""

from arq import cron
from arq.connections import RedisSettings

from core.config import Settings
from core.observability import init_sentry

from .maintenance import purge_files
from .reports.task import render_report

_settings = Settings()  # type: ignore[call-arg]

# Воркер падает молча: у него нет ни ответа клиенту, ни экрана. Отчёт, который
# не собрался ночью, обнаруживался утром по пустой ссылке. Ничего не делает,
# пока SENTRY_DSN пуст.
init_sentry("worker")


class WorkerSettingsARQ:
    functions: list = [render_report]
    # Уборка файлов — ночью и раз в сутки: работа дисковая, торопиться некуда,
    # а днём том занят выдачей отчётов и вложений.
    cron_jobs: list = [cron(purge_files, hour=3, minute=30)]
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
