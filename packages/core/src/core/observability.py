"""Отправка ошибок в Sentry — одна на все приложения (api, worker, bot).

`SENTRY_DSN` объявлен в настройках с самого начала, но ничего не инициализировал:
зависимости не было, вызова тоже. Об ошибках узнавали из `docker logs` и от
участников фокус-группы — то есть позже всех.

Настройки здесь строгие, и это не перестраховка. Sentry — внешняя служба, а в
запросах KetoCare ходят клинические данные: состав дня, замеры, заметки врача.
Поэтому:

- `send_default_pii=False` — ни заголовков с токеном, ни адреса, ни имени
  пользователя;
- `max_request_body_size="never"` — тело запроса не уходит НИКОГДА. Именно в нём
  лежат назначение, дневник и переписка с врачом;
- трассировки выключены по умолчанию: они собирают адреса запросов целиком и
  нужны для производительности, а не для ошибок;
- `_scrub_event` дополнительно снимает строку запроса: в `?date=` и `?q=` тоже
  бывает лишнее.

В событие всё равно попадает путь запроса, а в нём — идентификаторы пациентов.
Это псевдонимы: сами по себе они не называют ни ребёнка, ни семью, и без базы
KetoCare не значат ничего. Обмен осознанный: без пути невозможно понять, где
именно сломалось.

Ничего не включается, пока `SENTRY_DSN` пуст, — то есть по умолчанию.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .config import get_settings

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint


def init_sentry(component: str) -> bool:
    """Подключает отправку ошибок. Возвращает False, если DSN не задан.

    `component` попадает в тег `component`: api, worker и bot падают
    по-разному, и разделять их в интерфейсе Sentry нужно с первого события.
    """

    settings = get_settings()
    if not settings.sentry_dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        # Данные пользователя не собираются: см. модульный комментарий.
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=_scrub_event,
    )
    sentry_sdk.set_tag("component", component)
    return True


def _scrub_event(event: Event, _hint: Hint) -> Event:
    """Снимает с события то, что может нести данные пациента.

    Sentry и сам чистит заголовки и куки, но строка запроса остаётся: в `?q=`
    поиска продукта и в `?date=` дня лишнего нет, а вот в будущих ручках может
    появиться. Дешевле снять её сразу, чем однажды обнаружить в чужой системе.
    """

    request: Any = event.get("request")
    if isinstance(request, dict):
        request.pop("query_string", None)
        request.pop("data", None)
        request.pop("cookies", None)

    return event
