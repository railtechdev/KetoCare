"""Предохранители, которые видно только «снаружи» клиента.

Здесь три вещи, каждая — по находке ревью: блокировка, под которой идут проверка
и запись; уборка вызовов, оборвавшихся вместе с процессом; отказ, когда ключа в
окружении нет вовсе.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from core.models import AiJob
from core.models.enums import AiJobKind, AiJobStatus
from core.repositories import ai_jobs as ai_jobs_repo
from worker.ai.client import AiClient, NotConfigured
from worker.maintenance import AI_JOB_STUCK_AFTER, close_stuck_ai_jobs

from .test_ai_client import FakeAnthropic, FakeMessages, answer, settings_with


class TestBudgetLock:
    async def test_the_lock_actually_blocks_another_connection(
        self, sessionmaker: async_sessionmaker
    ) -> None:
        """Проверка и запись — «прочитали, потом записали», и без настоящей
        блокировки одновременные задачи проходят предохранитель разом.

        Проверяется не факт вызова, а свойство: пока блокировка взята, второе
        соединение её не получает. Второе соединение здесь обязательно —
        advisory-блокировки в PostgreSQL повторно входимы внутри одной сессии,
        и на одном соединении тест был бы зелёным всегда.
        """

        engine = create_async_engine(os.environ["TEST_DATABASE_URL"], poolclass=NullPool)
        try:
            async with sessionmaker() as holder:
                await ai_jobs_repo.lock_budget(holder)

                async with engine.connect() as other:
                    await other.begin()
                    taken = await other.scalar(
                        select(func.pg_try_advisory_xact_lock(ai_jobs_repo.BUDGET_LOCK_KEY))
                    )
                    assert taken is False
        finally:
            await engine.dispose()


class TestClientTakesTheLock:
    async def test_lock_is_taken_before_the_check_and_the_row(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Работающая блокировка, которую забыли взять, не защищает ничего.

        Порядок важен так же, как факт: взять её после подсчёта расхода — то же
        самое, что не брать вовсе.
        """

        order: list[str] = []
        original_lock = ai_jobs_repo.lock_budget
        original_count = ai_jobs_repo.cost_since
        original_create = ai_jobs_repo.create

        async def lock(session, *args, **kwargs):  # type: ignore[no-untyped-def]
            order.append("lock")
            return await original_lock(session, *args, **kwargs)

        async def cost(session, **kwargs):  # type: ignore[no-untyped-def]
            order.append("check")
            return await original_count(session, **kwargs)

        async def create(session, **kwargs):  # type: ignore[no-untyped-def]
            order.append("create")
            return await original_create(session, **kwargs)

        monkeypatch.setattr(ai_jobs_repo, "lock_budget", lock)
        monkeypatch.setattr(ai_jobs_repo, "cost_since", cost)
        monkeypatch.setattr(ai_jobs_repo, "create", create)

        client = AiClient(
            sessionmaker=sessionmaker,
            anthropic=FakeAnthropic(FakeMessages(answer())),
            settings=settings_with(),
        )
        await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={},
        )

        assert order == ["lock", "check", "create"]


class TestStuckJobsAreClosed:
    async def test_abandoned_call_is_marked_failed_but_keeps_its_reservation(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Процесс воркера может умереть посреди вызова. Строка не должна
        оставаться «выполняется» вечно — но и бронь снимать нельзя: деньги за
        вызов ушли, и вычесть их обратно значило бы соврать бюджету в более
        опасную сторону."""

        async with sessionmaker() as session:
            job = await ai_jobs_repo.create(
                session,
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                payload={},
                model="claude-opus-5",
                reserved_cost_usd=None,
            )
            job.cost_usd = 2.5
            job.created_at = datetime.now(UTC) - AI_JOB_STUCK_AFTER - timedelta(minutes=1)
            job_id = job.id
            await session.commit()

        await _run_reaper(sessionmaker)

        async with sessionmaker() as session:
            closed = await ai_jobs_repo.get(session, job_id)
            assert closed is not None
            assert closed.status == AiJobStatus.FAILED
            assert float(closed.cost_usd or 0) == pytest.approx(2.5)
            assert closed.finished_at is not None

    async def test_a_call_in_flight_is_left_alone(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Иначе уборщик закрывал бы вызовы, которые ещё идут."""

        async with sessionmaker() as session:
            job = await ai_jobs_repo.create(
                session,
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                payload={},
                model="claude-opus-5",
            )
            job_id = job.id
            await session.commit()

        await _run_reaper(sessionmaker)

        async with sessionmaker() as session:
            job = await ai_jobs_repo.get(session, job_id)
            assert job is not None
            assert job.status == AiJobStatus.RUNNING


class TestNotConfigured:
    async def test_missing_api_key_is_refused_before_the_journal(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Без ключа обращаться нечем: строка в журнале была бы записью о том,
        чего не было."""

        client = AiClient(
            sessionmaker=sessionmaker,
            anthropic=FakeAnthropic(FakeMessages(answer())),
            settings=settings_with(anthropic_api_key=""),
        )

        with pytest.raises(NotConfigured):
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )

        async with sessionmaker() as session:
            assert list(await session.scalars(select(AiJob))) == []


async def _run_reaper(sessionmaker: async_sessionmaker) -> None:
    """Задача берёт sessionmaker сама; в тесте он должен быть тестовым —
    иначе уборка пойдёт по настоящей базе мимо отката."""

    import worker.maintenance as maintenance

    original = maintenance.get_sessionmaker
    maintenance.get_sessionmaker = lambda: sessionmaker  # type: ignore[assignment]
    try:
        await close_stuck_ai_jobs({})
    finally:
        maintenance.get_sessionmaker = original  # type: ignore[assignment]
