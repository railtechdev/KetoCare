"""Budget fill levels (ADR-0081): when 80 % becomes a warning."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from core.ai_budget import BudgetLevel, BudgetUsage, alerts

START = datetime(2026, 11, 14, 19, 0, tzinfo=UTC)


def usage(spent: str, budget: str = "10", scope: str = "project") -> BudgetUsage:
    return BudgetUsage(
        scope=scope,  # type: ignore[arg-type]
        period="day",
        period_start=START,
        spent_usd=Decimal(spent),
        budget_usd=Decimal(budget),
    )


@pytest.mark.parametrize(
    ("spent", "level", "percent"),
    [
        ("0", None, 0),
        ("7.99", None, 79),
        ("8", BudgetLevel.WARNING, 80),
        ("9.999", BudgetLevel.WARNING, 99),
        ("10", BudgetLevel.EXHAUSTED, 100),
        ("12.5", BudgetLevel.EXHAUSTED, 125),
    ],
)
def test_level_and_percent(spent: str, level: BudgetLevel | None, percent: int) -> None:
    assert usage(spent).level is level
    assert usage(spent).percent == percent


def test_alert_id_is_stable_and_distinct() -> None:
    assert usage("8").alert_id() == usage("9").alert_id()
    assert usage("8").alert_id() != usage("10").alert_id(), "a new level is a new warning"
    assert usage("8").alert_id() != usage("8", scope="families").alert_id()
    later = BudgetUsage(
        scope="project",
        period="day",
        period_start=datetime(2026, 11, 15, 19, 0, tzinfo=UTC),
        spent_usd=Decimal("8"),
        budget_usd=Decimal("10"),
    )
    assert later.alert_id() != usage("8").alert_id(), "tomorrow warns again"


def test_alerts_fullest_first_and_quiet_ones_dropped() -> None:
    found = alerts([usage("1"), usage("8.5", scope="families"), usage("11", scope="technical")])

    assert [item.scope for item in found] == ["technical", "families"]


def test_a_raised_budget_warns_again() -> None:
    assert usage("8").alert_id() != usage("16", budget="20").alert_id()
    assert usage("8", budget="10").alert_id() == usage("8", budget="10.00").alert_id()


def test_the_warning_share_is_the_administrators() -> None:
    early = BudgetUsage(
        scope="project",
        period="day",
        period_start=START,
        spent_usd=Decimal("6"),
        budget_usd=Decimal("10"),
        warn_share=Decimal("0.6"),
    )
    assert early.level is BudgetLevel.WARNING
    assert usage("6").level is None


def test_price_suggestion_belongs_to_the_connection_kind() -> None:
    """`gpt-4o` is OpenAI's price: typed under Anthropic it must not be offered."""

    from core.ai_price_map import suggest_price

    assert suggest_price("anthropic", "gpt-4o") is None
    found = suggest_price("openai", "gpt-4o")
    assert found is not None and all(price > 0 for price in found)
