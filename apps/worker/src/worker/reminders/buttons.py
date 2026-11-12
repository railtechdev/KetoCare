"""Кнопки под сообщениями воркера в Telegram (ADR-0076).

Напоминание без кнопки заставляло искать нужную кнопку в меню, а уведомление
«откройте приложение, вкладка „Меню“» — искать приложение. Теперь:

- под напоминанием — кнопка, которая запускает сценарий бота («Записать
  кетоны»): нажатие приходит боту (`bot.handlers.scenarios.reminder_start`);
- под уведомлением — кнопка приложения (`web_app`, Bot API 6.0), открывающая
  нужный экран: адрес Mini App с `?open=<экран>`. Инлайновая `web_app`-кнопка,
  в отличие от кнопки обычной клавиатуры, выдаёт подпись запуска; работает
  только в личной переписке — а бот только в ней и живёт.

Без https-адреса приложения кнопки приложения нет: Telegram отверг бы всё
сообщение. Ночью уведомления уходят без звука (`disable_notification`).

Разметка — словарь Bot API, а не объекты aiogram: воркер от aiogram не
зависит и шлёт `sendMessage` сам (`telegram.py`).
"""

from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Any, Final
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import texts

#: Формат кнопки напоминания — `rem:<действие>:<patient_id.hex>`. Его же
#: разбирает бот (`bot.keyboards.REMINDER_PREFIX`); совпадение держит тест бота.
REMINDER_PREFIX: Final = "rem:"

#: Вид напоминания → действие бота и подпись кнопки.
REMINDER_ACTIONS: Final[dict[str, str]] = {
    "ketones": "ketones",
    "weight": "weight",
    "medications": "medications",
    "no_records": "wellbeing",
}
_REMINDER_LABELS: Final[dict[str, str]] = {
    "ketones": "btn_record_ketones",
    "weight": "btn_record_weight",
    "medications": "btn_record_medications",
    "wellbeing": "btn_record_wellbeing",
}

#: Экраны Mini App, которые открывает `?open=` (контракт с `apps/miniapp`).
OPEN_TARGETS: Final = frozenset(
    {
        "today",
        "menu",
        "diary",
        "diary-seizures",
        "diary-ketones",
        "diary-weight",
        "diary-medications",
        "diary-side-effects",
        "settings",
        "family",
        "reminders",
    }
)

#: Тихие часы по поясу проекта: уведомление о событии, случившемся ночью
#: (врач поправил назначение в одиннадцать вечера), не будит семью — оно
#: приходит без звука и ждёт утра. Напоминания сюда не относятся: их время
#: семья выбрала сама.
QUIET_FROM: Final = time(22, 0)
QUIET_TO: Final = time(7, 0)


def quiet(now_local: datetime) -> bool:
    moment = now_local.time()
    return moment >= QUIET_FROM or moment < QUIET_TO


def app_link(base: str, target: str) -> str | None:
    """Адрес Mini App, открывающий экран `target`; None — кнопки не будет."""

    base = base.strip()
    if not base.startswith("https://") or target not in OPEN_TARGETS:
        return None
    parts = urlsplit(base)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "open"]
    query.append(("open", target))
    return urlunsplit(parts._replace(query=urlencode(query)))


def _markup(rows: list[list[dict[str, Any]]]) -> dict[str, Any] | None:
    rows = [row for row in rows if row]
    return {"inline_keyboard": rows} if rows else None


def _app_button(
    language: str | None, base: str, target: str, label_key: str
) -> list[dict[str, Any]]:
    url = app_link(base, target)
    if url is None:
        return []
    return [{"text": texts.text(language, label_key), "web_app": {"url": url}, "style": "primary"}]


def open_app(
    language: str | None, *, base: str, target: str, label_key: str
) -> dict[str, Any] | None:
    """Одна кнопка приложения под уведомлением — или ничего без адреса."""

    return _markup([_app_button(language, base, target, label_key)])


def reminder(
    kind: str, *, patient_id: uuid.UUID, language: str | None, base: str
) -> dict[str, Any] | None:
    """Кнопки напоминания: «Записать…» в боте и, вечером, дневник в приложении."""

    action = REMINDER_ACTIONS.get(kind)
    if action is None:
        return None
    rows = [
        [
            {
                "text": texts.text(language, _REMINDER_LABELS[action]),
                "callback_data": f"{REMINDER_PREFIX}{action}:{patient_id.hex}",
            }
        ]
    ]
    if kind == "no_records":
        rows.append(_app_button(language, base, "diary", "btn_open_diary"))
    return _markup(rows)
