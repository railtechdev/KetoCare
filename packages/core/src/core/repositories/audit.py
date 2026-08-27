"""Запись в `audit_log` (раздел 4.2, 11 ТЗ).

Обязательна для: назначений, правок продуктов/рецептов, операций с учётными
записями, выгрузок данных, привязки/отвязки Telegram (раздел 4.2 ТЗ).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog


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
