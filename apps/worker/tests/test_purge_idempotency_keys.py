"""Ночная уборка ключей повторной отправки (ADR-0035).

Тест ведёт свою сессию, а не фикстурную: задача работает своей и коммитит, и
из внешней транзакции с откатом она подготовленных данных не увидит. Отсюда и
уборка в `finally`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import delete, select

from core.db import get_engine, get_sessionmaker
from core.models import IdempotencyKey, User
from core.models.enums import UserRole
from core.repositories import users as users_repo
from worker.maintenance import purge_idempotency_keys


class TestPurgeIdempotencyKeys:
    @pytest_asyncio.fixture(autouse=True)
    async def _fresh_engine(self):
        """Движок задачи кэширован на процесс, а цикл событий у каждого теста свой."""

        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
        yield
        await get_engine().dispose()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()

    async def test_removes_expired_and_keeps_fresh(self):
        # В сохранённом ответе — данные ребёнка, а нужен он сутки: только чтобы
        # повтор потерянного ответа не создал вторую запись.
        now = datetime.now(UTC)
        async with get_sessionmaker()() as session:
            user = await users_repo.create(
                session,
                role=UserRole.PARENT,
                full_name="Родитель для ключей",
                email=f"idem-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="x",
            )
            old = IdempotencyKey(
                user_id=user.id,
                key=f"old-{uuid.uuid4()}",
                request_hash="0" * 64,
                created_at=now - timedelta(hours=25),
            )
            fresh = IdempotencyKey(
                user_id=user.id,
                key=f"fresh-{uuid.uuid4()}",
                request_hash="0" * 64,
                created_at=now - timedelta(hours=1),
            )
            session.add_all([old, fresh])
            await session.commit()
            user_id, fresh_key = user.id, fresh.key

        try:
            result = await purge_idempotency_keys({})

            assert result["idempotency_keys"] >= 1
            async with get_sessionmaker()() as session:
                left = set(
                    await session.scalars(
                        select(IdempotencyKey.key).where(IdempotencyKey.user_id == user_id)
                    )
                )
            assert left == {fresh_key}
        finally:
            async with get_sessionmaker()() as session:
                await session.execute(
                    delete(IdempotencyKey).where(IdempotencyKey.user_id == user_id)
                )
                await session.execute(delete(User).where(User.id == user_id))
                await session.commit()
