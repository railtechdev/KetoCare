"""Ответ `GET /health/ai` — состояние ИИ-подсистемы для монитора доступности."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AiJobCounts(BaseModel):
    """Обращения к модели за окно наблюдения, по исходу."""

    succeeded: int
    failed: int
    running: int
    #: «Выполняются» дольше, чем длится любой вызов: процесс прервался.
    stuck: int


class AiFailureClass(BaseModel):
    """Класс ошибки (`BadRequestError 400 invalid_request_error`) и сколько раз он был."""

    error_class: str
    count: int


class AiConfigured(BaseModel):
    """Заданы ли переменные окружения. Только да/нет — значения не отдаются."""

    api_key: bool
    model_fast: bool
    model_smart: bool


class AiHealth(BaseModel):
    """Без данных пациентов и без текста ошибок: только счёт, время и класс."""

    window_hours: int
    checked_at: datetime
    jobs: AiJobCounts
    last_success_at: datetime | None
    last_failure_at: datetime | None
    last_failure_class: str | None
    #: Классы неудач за окно, частые первыми; не больше десяти.
    failure_classes: list[AiFailureClass]
    #: Дневной бюджет проекта исчерпан: отказы по нему в журнал не пишутся,
    #: поэтому видны только так.
    daily_budget_exhausted: bool
    configured: AiConfigured
