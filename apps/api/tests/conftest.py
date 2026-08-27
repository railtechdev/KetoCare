"""Фикстуры интеграционных тестов API: реальная БД + httpx ASGI-транспорт.

Каждый тест работает во внешней транзакции, которая откатывается, поэтому
БД между тестами чистая. Зависимость `get_session` подменяется на сессию теста.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api.deps.auth import get_session
from api.main import create_app
from api.security import create_token, hash_password
from core.models.enums import Sex, UserRole
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    os.environ.get(
        "DATABASE_URL", "postgresql+asyncpg://ketocare:ketocare@localhost:5432/ketocare"
    ),
)

TEST_PASSWORD = "correct horse battery staple"


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    connection = await engine.connect()
    transaction = await connection.begin()
    async_session = async_sessionmaker(bind=connection, expire_on_commit=False)()

    try:
        yield async_session
    finally:
        await async_session.close()
        await transaction.rollback()
        await connection.close()
        await engine.dispose()


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def _override_session() -> AsyncIterator[AsyncSession]:
        # Коммит подменён на flush: данные видны внутри теста, но откатываются фикстурой.
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


@pytest.fixture
def make_user(session: AsyncSession):
    """Фабрика пользователей. Фикстура, а не импортируемая функция: тесты запускаются
    в режиме --import-mode=importlib, где conftest не импортируется по имени."""

    async def _make(role: UserRole, *, totp_secret: str | None = None, is_active: bool = True):
        user = await users_repo.create(
            session,
            role=role,
            full_name=f"Тест {role.value}",
            email=f"{role.value}-{uuid.uuid4().hex[:10]}@example.com",
            password_hash=hash_password(TEST_PASSWORD),
        )
        user.totp_secret = totp_secret
        user.is_active = is_active
        await session.flush()
        return user

    return _make


@pytest.fixture
def make_patient(session: AsyncSession):
    async def _make(full_name: str = "Тестовый Ребёнок"):
        return await patients_repo.create(
            session, full_name=full_name, birth_date=date(2018, 5, 1), sex=Sex.M
        )

    return _make


@pytest.fixture
def auth_headers():
    def _headers(user) -> dict[str, str]:
        token = create_token(user_id=user.id, role=user.role, token_type="access")
        return {"Authorization": f"Bearer {token}"}

    return _headers
