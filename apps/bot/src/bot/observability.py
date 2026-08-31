"""Отправка ошибок бота в Sentry.

Повторяет `core.observability`, и это осознанный повтор: бот не зависит от
`core` — у него нет доступа к БД (раздел 7 ТЗ), и тянуть ради одной функции
SQLAlchemy в его образ незачем. Настройки те же и по той же причине: Sentry —
внешняя служба, а через бота проходят замеры, вес и самочувствие ребёнка.

Ничего не включается, пока `SENTRY_DSN` пуст, — то есть по умолчанию.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .config import BotSettings

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint


def init_sentry(settings: BotSettings) -> bool:
    """Подключает отправку ошибок. Возвращает False, если DSN не задан."""

    if not settings.sentry_dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        # Ни имени пользователя Telegram, ни его идентификатора: chat_id — это
        # прямая связь с семьёй, и в чужой системе ему делать нечего.
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=_scrub_event,
    )
    sentry_sdk.set_tag("component", "bot")
    return True


def _scrub_event(event: Event, _hint: Hint) -> Event:
    """Снимает с события тело запроса и строку параметров.

    В сообщениях бота ходят замеры и самочувствие ребёнка, а в запросах к
    API — его идентификатор вместе с данными дневника.
    """

    request: Any = event.get("request")
    if isinstance(request, dict):
        request.pop("query_string", None)
        request.pop("data", None)
        request.pop("cookies", None)
    return event
