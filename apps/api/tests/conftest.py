"""Фикстуры интеграционных тестов API: реальная БД + httpx ASGI-транспорт.

Каждый тест работает во внешней транзакции, которая откатывается, поэтому
БД между тестами чистая. Зависимость `get_session` подменяется на сессию теста.
"""

from __future__ import annotations

import itertools
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
from api.ratelimit import limiter
from api.security import create_token, hash_password
from api.services import queue as queue_service
from core.models.enums import Sex, UserRole
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

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


#: Счётчик тестов: из него получается уникальный адрес клиента (см. `client`).
_test_client_seq = itertools.count(1)


@pytest.fixture(autouse=True)
def enqueued(monkeypatch) -> list[tuple[str, tuple]]:
    """Очередь в тестах — список, а не живой Redis.

    Иначе прогон складывал бы настоящие задачи в очередь разработчика, и
    воркер, поднятый рядом, выполнял бы их — включая отправку сообщений в
    Telegram. Тесты, которым важна постановка задачи, читают этот список.
    """

    calls: list[tuple[str, tuple]] = []

    async def record(task: str, *args) -> None:
        calls.append((task, args))

    monkeypatch.setattr(queue_service, "enqueue", record)
    return calls


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Общий сброс счётчиков между тестами.

    Страховка, а не основной механизм: изоляцию даёт уникальный адрес клиента у
    каждого теста (`client`). Сброс остаётся на случай, если счётчик всё-таки
    переживёт тест — например, при добавлении лимита с ключом не по адресу.
    """

    limiter.reset()
    yield
    limiter.reset()


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def _override_session() -> AsyncIterator[AsyncSession]:
        # Коммит подменён на flush: данные видны внутри теста, но откатываются фикстурой.
        yield session

    app.dependency_overrides[get_session] = _override_session

    # У каждого теста свой адрес клиента, потому что ключ ограничения частоты —
    # это адрес (`ratelimit._client_key`).
    #
    # Пока все ходили с 127.0.0.1, тесты делили одно окно лимитера, и проверки
    # лимита зависели от порядка запуска: `test_rate_limited` в test_leads.py
    # проходил в составе файла и падал в одиночку, а `TestRateLimiting` в
    # test_auth_flows.py — наоборот. Общего сброса для этого не хватало: он
    # чистит хранилище между тестами, но не между запусками процесса и не между
    # тестом и живым сервером на той же Redis.
    #
    # Адрес из счётчика, а не случайный: воспроизводимость важнее уникальности
    # между прогонами, а внутри прогона счётчик её и даёт.
    number = next(_test_client_seq)
    host = f"10.0.{number // 256 % 256}.{number % 256}"
    transport = ASGITransport(app=app, client=(host, 12345))
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
