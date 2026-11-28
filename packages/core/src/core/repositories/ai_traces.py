"""Step timings of AI tasks (ADR-0094): written by the worker, read by the admin.

Rows carry durations only, so reading them needs no access to clinical data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Integer, cast, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from ..models import AiTrace
from ..models.enums import AiJobKind


async def add(
    session: AsyncSession,
    *,
    kind: AiJobKind,
    outcome: str,
    steps: dict[str, int],
    total_ms: int,
    model: str | None,
) -> None:
    session.add(AiTrace(kind=kind, outcome=outcome, steps=steps, total_ms=total_ms, model=model))
    await session.flush()


@dataclass(frozen=True)
class Timing:
    """Durations of one cut, milliseconds."""

    count: int
    median_ms: int
    p90_ms: int
    max_ms: int


@dataclass(frozen=True)
class SpeedRows:
    total: Timing | None
    steps: dict[str, Timing]
    #: Model reference → durations of the model step.
    models: dict[str, Timing]
    outcomes: dict[str, int]


def _timing(count: Any, median: Any, p90: Any, top: Any) -> Timing:
    return Timing(
        count=int(count or 0),
        median_ms=round(float(median or 0)),
        p90_ms=round(float(p90 or 0)),
        max_ms=int(top or 0),
    )


def _stats(value: ColumnElement[int] | InstrumentedAttribute[int]) -> list[ColumnElement[Any]]:
    return [
        func.count(),
        func.percentile_cont(0.5).within_group(value),
        func.percentile_cont(0.9).within_group(value),
        func.max(value),
    ]


async def speed_since(session: AsyncSession, *, kind: AiJobKind, since: datetime) -> SpeedRows:
    """Median, 90th percentile and maximum of every step since `since`.

    Percentiles, not means: one answer stuck for a minute in retries would
    drag a mean far from what a family usually waits, and the median would
    hide it — so both the usual and the bad case are shown.
    """

    recent = (AiTrace.kind == kind, AiTrace.created_at >= since)

    total_row = (await session.execute(select(*_stats(AiTrace.total_ms)).where(*recent))).one()
    total = _timing(*total_row) if total_row[0] else None

    step = func.jsonb_each_text(AiTrace.steps).table_valued("key", "value").render_derived("s")
    ms = cast(step.c.value, Integer)
    step_rows = await session.execute(
        select(step.c.key, *_stats(ms))
        .select_from(AiTrace)
        .join(step, true())
        .where(*recent)
        .group_by(step.c.key)
    )
    steps = {str(name): _timing(*rest) for name, *rest in step_rows.all()}

    model_ms = cast(AiTrace.steps["model"].astext, Integer)
    model_rows = await session.execute(
        select(AiTrace.model, *_stats(model_ms))
        .where(*recent, AiTrace.model.is_not(None), AiTrace.steps.has_key("model"))
        .group_by(AiTrace.model)
    )
    models = {str(model): _timing(*rest) for model, *rest in model_rows.all()}

    outcome_rows = await session.execute(
        select(AiTrace.outcome, func.count()).where(*recent).group_by(AiTrace.outcome)
    )
    outcomes = {str(outcome): int(count) for outcome, count in outcome_rows.all()}

    return SpeedRows(total=total, steps=steps, models=models, outcomes=outcomes)


__all__ = ["SpeedRows", "Timing", "add", "speed_since"]
