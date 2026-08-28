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

# Молчаливого запасного адреса здесь нет намеренно. Раньше им был
# `localhost:5432`, и на машине, где этот порт занимает база другого проекта,
# прогон выполнял бы DDL в чужой базе — от этого спасла только неподошедшая
# пара логина и пароля. Адрес берётся из `.env` (см. conftest.py в корне) или
# из окружения CI, и его отсутствие — это отказ, а не тихая подстановка.
DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "Не задан адрес тестовой БД: заполните DATABASE_URL в .env "
        "(см. .env.example) или задайте TEST_DATABASE_URL в окружении."
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
