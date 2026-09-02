"""Фикстуры воркера, которым нужна БД.

Журнал `ai_jobs` — не деталь реализации, а предохранитель: по нему считаются
дневной бюджет и суточный предел. Проверять его на подделке репозитория значит
проверять подделку, поэтому здесь настоящий PostgreSQL — как в `apps/api/tests`
и `packages/core/tests`.

Каждый тест идёт во внешней транзакции, которая откатывается. Клиент внутри
делает `commit`, и это работает: сессия привязана к соединению с уже открытой
транзакцией, поэтому её собственный commit закрывает вложенную точку сохранения,
а не внешнюю.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import date

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from core.models.enums import Sex, UserRole
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

# Молчаливого запасного адреса здесь нет намеренно — см. те же строки в
# `packages/core/tests/conftest.py`: прогон не должен уходить в чужую базу.
DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "Не задан адрес тестовой БД: заполните DATABASE_URL в .env "
        "(см. .env.example) или задайте TEST_DATABASE_URL в окружении."
    )


@pytest_asyncio.fixture
async def sessionmaker() -> AsyncIterator[async_sessionmaker]:
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    connection = await engine.connect()
    transaction = await connection.begin()
    maker = async_sessionmaker(bind=connection, expire_on_commit=False)

    try:
        yield maker
    finally:
        await transaction.rollback()
        await connection.close()
        await engine.dispose()


@pytest_asyncio.fixture
async def user_id(sessionmaker: async_sessionmaker) -> uuid.UUID:
    """Кто спрашивает: `ai_jobs.requested_by` — внешний ключ на живого человека."""

    async with sessionmaker() as session:
        user = await users_repo.create(
            session,
            role=UserRole.PARENT,
            full_name="Родитель Тестовый",
            email=f"parent-{uuid.uuid4()}@example.com",
            password_hash="x",
        )
        identifier = user.id
        await session.commit()
    return identifier


@pytest_asyncio.fixture
async def patient_id(sessionmaker: async_sessionmaker) -> uuid.UUID:
    """Про кого разбор: `ai_jobs.patient_id` — тоже внешний ключ."""

    async with sessionmaker() as session:
        patient = await patients_repo.create(
            session, full_name="Ребёнок Тестовый", birth_date=date(2021, 7, 15), sex=Sex.F
        )
        identifier = patient.id
        await session.commit()
    return identifier
