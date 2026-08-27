"""Фикстуры интеграционных тестов core: реальный PostgreSQL из docker-compose.dev.

Каждый тест выполняется в транзакции, которая откатывается — БД между тестами чистая.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    os.environ.get(
        "DATABASE_URL", "postgresql+asyncpg://ketocare:ketocare@localhost:5432/ketocare"
    ),
)


@pytest_asyncio.fixture
async def engine():
    """Function-scoped: asyncio-фикстуры pytest-asyncio живут в event loop теста,
    а session-scoped engine пережил бы свой loop и падал бы на закрытии соединений."""

    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    """Сессия внутри внешней транзакции: всё, что тест записал, откатывается."""

    connection = await engine.connect()
    transaction = await connection.begin()
    maker = async_sessionmaker(bind=connection, expire_on_commit=False)
    async_session = maker()

    try:
        yield async_session
    finally:
        await async_session.close()
        await transaction.rollback()
        await connection.close()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "db: тест требует запущенный PostgreSQL")
