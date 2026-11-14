"""The 80 % warning on AI budgets (ADR-0081, stage 2 of the architecture audit).

Every five minutes the worker compares what each budget's period has spent with
the budget itself (`core.ai_budget`). A budget reaching 80 % — and then 100 % —
gets one row in the audit journal for that period: the administrator sees it in
the journal, and the admin home and the «Модели и расход» section show the live
state on their own. The product sends no e-mail, and administrators are not on
Telegram, so the cabinet is where the warning is read.

Once per budget, period and level: the row's entity id is derived from the three
(`BudgetUsage.alert_id`), and an existing row means the warning was given.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core import ai_budget
from core.ai_budget import BudgetLevel, BudgetUsage
from core.config import Settings
from core.db import get_sessionmaker
from core.repositories import audit as audit_repo


def _snapshot(usage: BudgetUsage) -> dict[str, Any]:
    return {
        "scope": usage.scope,
        "period": usage.period,
        "period_start": usage.period_start.isoformat(),
        "spent_usd": str(usage.spent_usd),
        "budget_usd": str(usage.budget_usd),
        "percent": usage.percent,
    }


async def _record(session: AsyncSession, usage: BudgetUsage) -> bool:
    """Write the journal row for this level unless it is already there."""

    entity_id = usage.alert_id()
    if usage.level is BudgetLevel.EXHAUSTED:
        if await audit_repo.exists(
            session, action="ai_budget_exhausted", entity="ai_budget", entity_id=entity_id
        ):
            return False
        await audit_repo.write_audit_log(
            session,
            user_id=None,
            action="ai_budget_exhausted",
            entity="ai_budget",
            entity_id=entity_id,
            after=_snapshot(usage),
        )
        return True
    if await audit_repo.exists(
        session, action="ai_budget_warning", entity="ai_budget", entity_id=entity_id
    ):
        return False
    await audit_repo.write_audit_log(
        session,
        user_id=None,
        action="ai_budget_warning",
        entity="ai_budget",
        entity_id=entity_id,
        after=_snapshot(usage),
    )
    return True


async def record_budget_alerts(
    session: AsyncSession, settings: Settings, now: datetime | None = None
) -> int:
    """Journal every budget at or over 80 % once per period and level."""

    found = ai_budget.alerts(await ai_budget.usages(session, settings, now or datetime.now(UTC)))
    written = 0
    for usage in found:
        written += await _record(session, usage)
    return written


async def watch_ai_budgets(ctx: dict[str, Any]) -> dict[str, int]:
    settings = Settings()  # type: ignore[call-arg]
    async with get_sessionmaker()() as session:
        written = await record_budget_alerts(session, settings)
        await session.commit()
    return {"recorded": written}
