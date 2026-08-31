"""Задача ARQ `notify_family` (раздел 5.4 ТЗ).

Врач меняет назначение — семья должна узнать об этом сегодня, а не когда
в следующий раз откроет кабинет. Кетосоотношение и калорийность определяют
каждый приём пищи: сутки готовки по старому назначению — это сутки не той
терапии.

Текст не называет чисел. Соблазн назвать их был — «назначение изменилось»
заставляет открыть кабинет, чтобы понять, изменилось ли важное, — но раздел 7.5
ТЗ запрещает боту показывать параметры назначения, а раздел 5.4 задаёт саму
формулировку. Причина не в формальности: чат мог быть привязан к групповому, и
кетосоотношение с калорийностью ушли бы всем его участникам.
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


async def notify_family(ctx: dict[str, Any], patient_id: str) -> int:
    """Сообщить семье о новом назначении. Возвращает число доставленных чатов."""

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        # Установка без бота. Не сбой: назначение уже сохранено, а канала
        # доставки просто нет.
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_links_for_patient(session, uuid.UUID(patient_id))
        for link in links:
            if link.revoked_at is not None:
                continue
            try:
                await send_message(
                    client, token=settings.bot_token, chat_id=link.chat_id, text=NOTICE
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


#: Текст уведомления (раздел 5.4 ТЗ — формулировка оттуда).
#:
#: Ни цифр, ни ФИО: параметры назначения бот не показывает (раздел 7.5), а имя
#: ребёнка в чате незачем — чат и так привязан к нему одному.
NOTICE = (
    "Врач обновил назначение. Откройте кабинет: меню на ближайшие дни нужно "
    "пересчитать под новые цели."
)
