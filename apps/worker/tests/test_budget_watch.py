"""The 80 % warning on AI budgets is journaled once per period and level (ADR-0081)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from core import app_settings
from core.app_settings import AiGroup, GroupOverrides
from core.config import Settings
from core.models import AiJob, AuditLog
from core.models.enums import AiJobKind, AiJobStatus
from worker.ai.budget_watch import record_budget_alerts


def settings_with(**overrides: Any) -> Settings:
    base = Settings()  # type: ignore[call-arg]
    # A large project budget: only the group budget under test may fire.
    return base.model_copy(update={"ai_daily_budget_usd": 1000.0, **overrides})


async def _spend(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID, kind: AiJobKind, cost: float
) -> None:
    async with sessionmaker() as session:
        session.add(
            AiJob(
                kind=kind,
                status=AiJobStatus.DONE,
                requested_by=user_id,
                input={},
                model="claude-opus-5",
                cost_usd=cost,
            )
        )
        await session.commit()


async def _watch(sessionmaker: async_sessionmaker, settings: Settings) -> int:
    async with sessionmaker() as session:
        written = await record_budget_alerts(session, settings)
        await session.commit()
    return written


async def _rows(sessionmaker: async_sessionmaker) -> list[AuditLog]:
    async with sessionmaker() as session:
        return list(
            await session.scalars(
                select(AuditLog).where(AuditLog.entity == "ai_budget").order_by(AuditLog.created_at)
            )
        )


async def test_warning_once_then_exhausted_once(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID
) -> None:
    settings = settings_with()
    async with sessionmaker() as session:
        await app_settings.save_group(
            session, AiGroup.TECHNICAL, GroupOverrides(daily_budget_usd=Decimal("2")), by=None
        )
        await session.commit()

    await _spend(sessionmaker, user_id, AiJobKind.RECIPE_IMPORT, 1.0)
    assert await _watch(sessionmaker, settings) == 0, "50 % is not a warning"

    await _spend(sessionmaker, user_id, AiJobKind.RECIPE_IMPORT, 0.7)
    assert await _watch(sessionmaker, settings) == 1
    assert await _watch(sessionmaker, settings) == 0, "the same warning is not repeated"

    await _spend(sessionmaker, user_id, AiJobKind.RECIPE_IMPORT, 0.5)
    assert await _watch(sessionmaker, settings) == 1
    assert await _watch(sessionmaker, settings) == 0

    rows = await _rows(sessionmaker)
    assert [row.action for row in rows] == ["ai_budget_warning", "ai_budget_exhausted"]
    assert rows[0].user_id is None
    assert rows[0].after is not None
    assert rows[0].after["scope"] == "technical"
    assert rows[0].after["period"] == "day"
    assert rows[0].after["percent"] == 85
    assert Decimal(rows[0].after["budget_usd"]) == Decimal("2")
    assert rows[1].after is not None and rows[1].after["percent"] == 110


async def test_another_groups_spend_does_not_fill_this_budget(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID
) -> None:
    async with sessionmaker() as session:
        await app_settings.save_group(
            session, AiGroup.FAMILIES, GroupOverrides(daily_budget_usd=Decimal("1")), by=None
        )
        await session.commit()

    await _spend(sessionmaker, user_id, AiJobKind.RECIPE_IMPORT, 5.0)

    assert await _watch(sessionmaker, settings_with()) == 0


async def test_project_daily_budget_from_the_environment_is_watched(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID
) -> None:
    await _spend(sessionmaker, user_id, AiJobKind.ASSISTANT, 0.9)

    assert await _watch(sessionmaker, settings_with(ai_daily_budget_usd=1.0)) == 1
    (row,) = await _rows(sessionmaker)
    assert row.action == "ai_budget_warning"
    assert row.after is not None and row.after["scope"] == "project"
