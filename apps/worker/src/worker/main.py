"""ARQ-воркер KetoCare.

Каркас этапа 1 (раздел 15 ТЗ, п.1). Задачи из раздела 10.1
(parse_free_text, assistant_reply, doctor_summary, render_report,
notify_family, reminders_cron, content_draft) добавляются на этапах 2-4.
"""

from arq.connections import RedisSettings
from pydantic_settings import BaseSettings


class WorkerSettings(BaseSettings):
    redis_url: str = "redis://localhost:6379/0"


_settings = WorkerSettings()  # type: ignore[call-arg]


class WorkerSettingsARQ:
    functions: list = []
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
