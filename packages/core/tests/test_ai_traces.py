"""Step timings of the assistant (ADR-0094): the recorder and the admin's numbers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core import ai_trace
from core.models import AiTrace
from core.models.enums import AiJobKind
from core.repositories import ai_traces as traces_repo


class TestRecorder:
    def test_steps_outside_a_trace_do_nothing(self) -> None:
        """The shared client marks steps everywhere, the API included."""

        with ai_trace.step("model"):
            pass
        ai_trace.note_model("anthropic/x")

    def test_a_failed_step_is_still_timed(self) -> None:
        """A step that broke after a minute is exactly what the trace is for."""

        with (
            ai_trace.tracing() as trace,
            pytest.raises(RuntimeError),
            ai_trace.step("model"),
        ):
            raise RuntimeError("timeout")
        assert "model" in trace.steps

    def test_a_repeated_step_adds_up(self) -> None:
        with ai_trace.tracing() as trace:
            trace.add("record", 3)
            trace.add("record", 4)
        assert trace.steps == {"record": 7}

    def test_the_trace_ends_with_its_block(self) -> None:
        with ai_trace.tracing() as trace:
            ai_trace.note_model("anthropic/x")
        with ai_trace.step("model"):
            pass
        assert trace.model == "anthropic/x"
        assert trace.steps == {}


async def _trace(
    session: AsyncSession,
    *,
    steps: dict[str, int],
    total_ms: int,
    outcome: str = "answered",
    model: str | None = "anthropic/smart",
    kind: AiJobKind = AiJobKind.ASSISTANT,
) -> None:
    await traces_repo.add(
        session, kind=kind, outcome=outcome, steps=steps, total_ms=total_ms, model=model
    )


async def test_speed_shows_the_usual_and_the_bad_case(session: AsyncSession) -> None:
    since = datetime.now(UTC) - timedelta(hours=1)
    for model_ms in (1000, 2000, 3000, 4000, 60000):
        await _trace(session, steps={"search": 10, "model": model_ms}, total_ms=model_ms + 500)
    await _trace(session, steps={"search": 12}, total_ms=300, outcome="no_material", model=None)
    # Another kind and an old row stay out.
    await _trace(session, steps={"model": 99999}, total_ms=99999, kind=AiJobKind.DOCTOR_SUMMARY)
    old = AiTrace(
        kind=AiJobKind.ASSISTANT,
        outcome="answered",
        steps={"model": 99999},
        total_ms=99999,
        created_at=since - timedelta(days=1),
    )
    session.add(old)
    await session.flush()

    rows = await traces_repo.speed_since(session, kind=AiJobKind.ASSISTANT, since=since)

    model = rows.steps["model"]
    assert (model.count, model.median_ms, model.max_ms) == (5, 3000, 60000)
    # One answer stuck in retries moves the 90th percentile, not the median.
    assert model.p90_ms > 20000
    assert rows.steps["search"].count == 6
    assert rows.total is not None and rows.total.count == 6
    assert rows.models == {"anthropic/smart": model}
    assert rows.outcomes == {"answered": 5, "no_material": 1}


async def test_no_answers_no_numbers(session: AsyncSession) -> None:
    rows = await traces_repo.speed_since(
        session, kind=AiJobKind.ASSISTANT, since=datetime.now(UTC) - timedelta(days=1)
    )
    assert rows.total is None
    assert rows.steps == {} and rows.models == {} and rows.outcomes == {}
