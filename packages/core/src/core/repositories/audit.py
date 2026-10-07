"""Запись в `audit_log` (раздел 4.2, 11 ТЗ).

Обязательна для: назначений, правок продуктов/рецептов, операций с учётными
записями, выгрузок данных, привязки/отвязки Telegram (раздел 4.2 ТЗ).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import ColumnElement, and_, func, or_, select
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


async def list_entries(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    entity: str | None = None,
    entity_id: uuid.UUID | None = None,
    action: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    """Журнал только читается: ручек изменения и удаления у него нет.

    Границы периода включают обе даты (`>=` / `<=`): администратор задаёт их как
    отрезок, а не как полуинтервал.
    """

    conditions: list[ColumnElement[bool]] = []
    if user_id is not None:
        conditions.append(AuditLog.user_id == user_id)
    if entity is not None:
        conditions.append(AuditLog.entity == entity)
    if entity_id is not None:
        conditions.append(AuditLog.entity_id == entity_id)
    if action is not None:
        conditions.append(AuditLog.action == action)
    if created_from is not None:
        conditions.append(AuditLog.created_at >= created_from)
    if created_to is not None:
        conditions.append(AuditLog.created_at <= created_to)

    stmt = (
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(AuditLog).where(*conditions))
    return items, int(total or 0)


#: Действия, которые совершают НАД учётной записью другие люди (находка Н5).
ACTIONS_ON_ACCOUNT = ("password_reset", "totp_reset", "update")


async def list_actions_on_account(
    session: AsyncSession, *, user_id: uuid.UUID, since: datetime
) -> list[AuditLog]:
    """Что делали с учётной записью другие — для сообщения её владельцу.

    Две группы записей: правки самой учётной записи (сброс пароля и второго
    фактора, смена роли и активности — `entity_id` она сама) и передача ведения,
    где она стоит в `before` или `after` (`transfer_care` пишется на ребёнка, а
    не на специалиста). Свои действия владельца сюда не попадают: о них он
    знает.
    """

    me = str(user_id)
    on_account = and_(
        AuditLog.entity == "users",
        AuditLog.entity_id == user_id,
        AuditLog.action.in_(ACTIONS_ON_ACCOUNT),
    )
    care = and_(
        AuditLog.action == "transfer_care",
        or_(
            AuditLog.before["doctor_id"].astext == me,
            AuditLog.after["doctor_id"].astext == me,
        ),
    )
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.created_at >= since,
            or_(AuditLog.user_id.is_(None), AuditLog.user_id != user_id),
            or_(on_account, care),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(500)
    )
    return list(await session.scalars(stmt))


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
