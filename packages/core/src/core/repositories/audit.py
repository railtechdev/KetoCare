"""Запись в `audit_log` (раздел 4.2, 11 ТЗ).

Обязательна для: назначений, правок продуктов/рецептов, операций с учётными
записями, выгрузок данных, привязки/отвязки Telegram (раздел 4.2 ТЗ).
"""

from __future__ import annotations

import uuid
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog

logger = structlog.get_logger(__name__)


async def write_audit_log(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    action: str,
    entity: str,
    entity_id: uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        before=before,
        after=after,
        ip=ip,
    )
    session.add(entry)
    await session.flush()
    return entry


async def write_audit_log_independent(
    *,
    user_id: uuid.UUID | None,
    action: str,
    entity: str,
    entity_id: uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    """Пишет запись аудита в собственной транзакции и сразу коммитит.

    Нужна для событий, которые фиксируются одновременно с отказом запроса
    (неудачный вход и т.п.): такой запрос завершается исключением, сессия
    ручки откатывается, и обычный `write_audit_log` — только `flush` без
    коммита — был бы отменён вместе с ней. То есть именно те события, ради
    которых аудит и ведётся, не сохранялись бы.

    Ошибка записи аудита не должна превращать 401 в 500, поэтому исключение
    логируется и подавляется.
    """

    from ..db import get_sessionmaker

    try:
        async with get_sessionmaker()() as session:
            session.add(
                AuditLog(
                    user_id=user_id,
                    action=action,
                    entity=entity,
                    entity_id=entity_id,
                    before=before,
                    after=after,
                    ip=ip,
                )
            )
            await session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("audit_log_write_failed", action=action, entity=entity)
