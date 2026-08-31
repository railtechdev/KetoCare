"""Отправка сообщения в Telegram из воркера.

Бот и воркер — разные процессы: бот слушает обновления (long polling), воркер
ходит по расписанию. Напоминание отправляет именно воркер — у бота нет ни
расписания, ни доступа к базе (раздел 7 ТЗ), а очередь «воркер → бот» означала
бы третий канал доставки со своими отказами.

Токен один и тот же (`BOT_TOKEN`): сообщение приходит от того же бота, к
которому семья привязала чат, — иначе это был бы незнакомый отправитель.
"""

from __future__ import annotations

import httpx
import structlog

logger = structlog.get_logger(__name__)

TELEGRAM_API = "https://api.telegram.org"


class TelegramSendError(RuntimeError):
    """Сообщение не ушло. Разбирается вызывающей стороной, а не глотается."""


async def send_message(client: httpx.AsyncClient, *, token: str, chat_id: int, text: str) -> None:
    """Отправляет текст в чат.

    Ошибка поднимается наверх: напоминание, которое не ушло, не должно
    выглядеть отправленным. Единственное исключение разбирает вызывающая
    сторона — блокировка бота пользователем: это не сбой доставки, а решение
    человека, и повторять его нечего.
    """

    response = await client.post(
        f"{TELEGRAM_API}/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text},
    )
    if response.is_success:
        return

    body = _describe(response)
    logger.warning("telegram_send_failed", chat_id=chat_id, status=response.status_code)
    raise TelegramSendError(body)


def _describe(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    return str(payload.get("description") or f"HTTP {response.status_code}")
