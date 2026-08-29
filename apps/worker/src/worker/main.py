"""ARQ-воркер KetoCare.

Задачи раздела 10.1 ТЗ подключаются по мере готовности этапов: сейчас здесь
`render_report` (раздел 15 п. 14), остальные (parse_free_text, assistant_reply,
doctor_summary, notify_family, reminders_cron, content_draft) появляются на
этапах 3-4.

Адрес Redis берётся из `core.config.Settings` — того же места, откуда его берёт
API. Своя `BaseSettings` у воркера читала только переменные процесса и не видела
`.env`: воркер молча слушал `localhost:6379`, пока API ставил задачи в Redis из
`.env`, и очередь никогда не сходилась. Один адрес — один источник.
"""

from arq.connections import RedisSettings

from core.config import Settings

from .reports.task import render_report

_settings = Settings()  # type: ignore[call-arg]


class WorkerSettingsARQ:
    functions: list = [render_report]
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
