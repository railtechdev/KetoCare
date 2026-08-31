"""Задача ARQ `notify_family` (раздел 5.4 ТЗ).

Врач меняет назначение — семья должна узнать об этом сегодня, а не когда
в следующий раз откроет кабинет. Кетосоотношение и калорийность определяют
каждый приём пищи: сутки готовки по старому назначению — это сутки не той
терапии.

Текст называет числа, а не «назначение изменилось»: последнее заставляет
открыть кабинет, чтобы понять, изменилось ли то, что важно прямо сейчас.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import structlog

from core.config import Settings
from core.db import get_sessionmaker
from core.repositories import telegram as telegram_repo

from .telegram import TelegramSendError, send_message

logger = structlog.get_logger(__name__)


async def notify_family(ctx: dict[str, Any], patient_id: str, prescription: dict[str, Any]) -> int:
    """Сообщить семье о новом назначении. Возвращает число доставленных чатов."""

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        # Установка без бота. Не сбой: назначение уже сохранено, а канала
        # доставки просто нет.
        return 0

    text = _text(prescription)
    sessionmaker = get_sessionmaker()
    delivered = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_links_for_patient(session, uuid.UUID(patient_id))
        for link in links:
            if link.revoked_at is not None:
                continue
            try:
                await send_message(
                    client, token=settings.bot_token, chat_id=link.chat_id, text=text
                )
            except TelegramSendError as exc:
                # Один заблокированный чат не отменяет уведомление остальным:
                # у ребёнка может быть привязано несколько.
                logger.warning(
                    "prescription_notice_not_delivered",
                    patient_id=patient_id,
                    reason=str(exc),
                )
                continue
            delivered += 1

    return delivered


def _text(prescription: dict[str, Any]) -> str:
    """Текст уведомления.

    ФИО и контактов здесь нет: чат привязан к одному ребёнку, и называть его
    по имени незачем — а Telegram не то место, где стоит хранить лишнее
    (раздел 13 ТЗ).
    """

    lines = [
        "Врач изменил назначение.",
        f"Кетосоотношение: {_ratio(prescription['ratio'])}",
        f"Калорийность: {prescription['kcal_per_day']} ккал в сутки",
        f"Белок: {_number(prescription['protein_g'])} г",
        f"Углеводы, не более: {_number(prescription['carbs_limit_g'])} г",
        "",
        "Меню на ближайшие дни нужно пересчитать под новые цифры.",
    ]
    return "\n".join(lines)


def _ratio(value: Any) -> str:
    """«4:1», а не «4.0»: семья знает соотношение в этой записи."""

    number = float(value)
    return f"{number:g}:1"


def _number(value: Any) -> str:
    return f"{float(value):g}"
