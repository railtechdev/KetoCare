"""How full each AI budget is, and when that becomes a warning (ADR-0081).

A budget is "full" for this module when the money spent in its period reaches a
share of it. Every budget that is set is watched: the project's daily one
(always set — the environment gives the fallback), the project's monthly one,
and each group's daily and monthly ones when the administrator set them.

The numbers are the ones `AiClient` refuses by: the same sums over `ai_jobs`
(reservations included) and the same local midnight. A warning computed any
other way would disagree with the refusal it warns about.
"""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from . import app_settings
from .app_settings import AiGroup
from .config import Settings
from .models.enums import AiJobKind
from .repositories import ai_jobs as ai_jobs_repo

#: The share of a budget at which the administrator is warned. Four fifths
#: leaves a working day's margin on a monthly budget and an hour or two on a
#: daily one — enough to raise it before families hear "limit reached".
WARN_SHARE = Decimal("0.8")

Period = Literal["day", "month"]

#: `"project"` or a group's value.
Scope = Literal["project", "technical", "specialists", "families"]

#: Stable namespace for the journal row of one budget, period and level: the
#: watcher writes it once, and the id is how it knows it already did.
_ALERT_NAMESPACE = uuid.UUID("0f6d0c39-3b1c-4d63-9a43-1d2b6a7c8e51")


class BudgetLevel(enum.StrEnum):
    WARNING = "warning"
    EXHAUSTED = "exhausted"


@dataclass(frozen=True)
class BudgetUsage:
    scope: Scope
    period: Period
    period_start: datetime
    spent_usd: Decimal
    budget_usd: Decimal

    @property
    def percent(self) -> int:
        """Whole percent, rounded down: "80 %" is shown only once 80 % is reached."""

        return int(self.spent_usd * 100 // self.budget_usd)

    @property
    def level(self) -> BudgetLevel | None:
        if self.spent_usd >= self.budget_usd:
            return BudgetLevel.EXHAUSTED
        if self.spent_usd >= self.budget_usd * WARN_SHARE:
            return BudgetLevel.WARNING
        return None

    def alert_id(self) -> uuid.UUID:
        """One id per budget amount, period start and level — the journal key.

        The amount is part of it: a budget raised after its warning and reached
        again in the same period is a new event, and the journal must show it.
        """

        level = self.level.value if self.level is not None else "none"
        amount = self.budget_usd.normalize()
        name = f"{self.scope}:{self.period}:{self.period_start.isoformat()}:{amount}:{level}"
        return uuid.uuid5(_ALERT_NAMESPACE, name)


def _sum(totals: dict[AiJobKind, Decimal], kinds: list[AiJobKind] | None) -> Decimal:
    if kinds is None:
        return sum(totals.values(), Decimal(0))
    return sum((totals.get(kind, Decimal(0)) for kind in kinds), Decimal(0))


async def usages(
    session: AsyncSession, settings: Settings, now: datetime | None = None
) -> list[BudgetUsage]:
    """Every budget that is set, with what its period has spent so far."""

    now = now or datetime.now(UTC)
    config = await app_settings.ai_config(session, settings)
    starts: dict[Period, datetime] = {
        "day": app_settings.day_start(settings.tz, now),
        "month": app_settings.month_start(settings.tz, now),
    }
    spent = {
        period: await ai_jobs_repo.cost_by_kind_since(session, since=since)
        for period, since in starts.items()
    }

    found: list[BudgetUsage] = []

    def add(
        scope: Scope, period: Period, kinds: list[AiJobKind] | None, budget: Decimal | None
    ) -> None:
        if budget is None or budget <= 0:
            return
        found.append(
            BudgetUsage(
                scope=scope,
                period=period,
                period_start=starts[period],
                spent_usd=_sum(spent[period], kinds),
                budget_usd=budget,
            )
        )

    add("project", "day", None, config.daily_budget_usd)
    add("project", "month", None, config.monthly_budget_usd)
    for group in AiGroup:
        own = config.groups[group]
        kinds = app_settings.kinds_of(group)
        scope: Scope = group.value
        add(scope, "day", kinds, own.daily_budget_usd)
        add(scope, "month", kinds, own.monthly_budget_usd)
    return found


def alerts(found: list[BudgetUsage]) -> list[BudgetUsage]:
    """Budgets at or over the warning share — the fullest first."""

    return sorted(
        (usage for usage in found if usage.level is not None),
        key=lambda usage: usage.spent_usd / usage.budget_usd,
        reverse=True,
    )


__all__ = ["WARN_SHARE", "BudgetLevel", "BudgetUsage", "alerts", "usages"]
