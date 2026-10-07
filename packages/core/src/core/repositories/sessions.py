"""Сессии, закрытые выходом (находка Н9 security-прохода от 07.10.2026).

Токены у нас без состояния: отзыв ВСЕХ сессий учётной записи делает отметка
смены пароля (`users.password_changed_at`). «Выйти» закрывает одну сессию — ту,
из которой нажали, — и для этого нужен перечень закрытых. Он короткий: строка
живёт до истечения срока токена обновления, после этого токен отвергается и
без неё.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RevokedSession


async def revoke(
    session: AsyncSession, *, session_id: str, user_id: uuid.UUID, expires_at: datetime
) -> None:
    """Закрыть сессию до `expires_at`. Повторный выход той же сессии — не ошибка."""

    # Истёкшие строки ничего не значат: токен с прошедшим `exp` отвергается
    # подписью. Чистка здесь, а не ночной задачей: выход редок, и перечень не
    # растёт быстрее, чем его чистят.
    await session.execute(
        delete(RevokedSession).where(RevokedSession.expires_at < datetime.now(UTC))
    )
    await session.execute(
        insert(RevokedSession)
        .values(session_id=session_id, user_id=user_id, expires_at=expires_at)
        .on_conflict_do_nothing(index_elements=[RevokedSession.session_id])
    )


async def is_revoked(session: AsyncSession, session_id: str) -> bool:
    found = await session.scalar(
        select(RevokedSession.session_id).where(RevokedSession.session_id == session_id)
    )
    return found is not None
