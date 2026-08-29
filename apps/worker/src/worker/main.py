"""ARQ-воркер KetoCare.

Задачи раздела 10.1 ТЗ подключаются по мере готовности этапов: сейчас здесь
`render_report` (раздел 15 п. 14), остальные (parse_free_text, assistant_reply,
doctor_summary, notify_family, reminders_cron, content_draft) появляются на
этапах 3-4.
"""

from arq.connections import RedisSettings
from pydantic_settings import BaseSettings

from .reports.task import render_report


class WorkerSettings(BaseSettings):
    redis_url: str = "redis://localhost:6379/0"


_settings = WorkerSettings()  # type: ignore[call-arg]


class WorkerSettingsARQ:
    functions: list = [render_report]
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
