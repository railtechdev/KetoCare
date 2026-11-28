"""How long each step of an AI task took (ADR-0094).

A trace is a set of named steps with their duration in milliseconds — and
nothing else: no question, no answer, no person, no child. It exists to answer
«why is the assistant slow» with numbers instead of a reading of the code.

The recorder lives in a context variable, so the shared client (`AiClient`)
marks its own steps — preparing the call, the model, recording the result —
without every task passing a stopwatch through. Outside a trace `step` does
nothing: the client runs the same way in the API and in tests.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Literal

#: Steps of the assistant answer in the order they happen. The admin area shows
#: them in this order; a step missing from a trace simply did not run (a
#: refused question never reaches the search, an empty search never reaches the
#: model).
ASSISTANT_STEPS = (
    # Waiting in the queue: from the API putting the task in to a worker taking it.
    "queue",
    "question_check",
    "search",
    # Settings, budget and limits, the `ai_jobs` row — before the model is called.
    "prepare",
    # The provider, including the carrier's own retries.
    "model",
    # Closing the `ai_jobs` row with tokens and cost.
    "record",
    "answer_check",
    # Writing the answer into the conversation.
    "save",
)

AssistantOutcome = Literal[
    "answered",
    # The question asked for something forbidden; the model was not called.
    "refused_question",
    # Nothing in the knowledge base; the model was not called.
    "no_material",
    # The model answered, the answer was replaced by the doctor template.
    "refused_answer",
    # A budget or a personal limit was spent.
    "limited",
    # No model, no key or the provider did not answer.
    "failed",
]

ASSISTANT_OUTCOMES: tuple[AssistantOutcome, ...] = (
    "answered",
    "refused_question",
    "no_material",
    "refused_answer",
    "limited",
    "failed",
)


@dataclass
class Trace:
    """Durations of named steps, milliseconds. A repeated step adds up."""

    steps: dict[str, int] = field(default_factory=dict)
    #: The model reference the call went to, when there was a call.
    model: str | None = None
    _started: float = field(default_factory=time.perf_counter, repr=False)

    def add(self, name: str, ms: int) -> None:
        self.steps[name] = self.steps.get(name, 0) + max(ms, 0)

    def elapsed_ms(self) -> int:
        return _ms_since(self._started)

    @contextmanager
    def step(self, name: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            # Recorded on failure too: a step that broke after fifty seconds is
            # exactly the step the trace is for.
            self.add(name, _ms_since(started))


_current: ContextVar[Trace | None] = ContextVar("ai_trace", default=None)


@contextmanager
def tracing() -> Iterator[Trace]:
    """Start a trace for the code inside the block."""

    trace = Trace()
    token = _current.set(trace)
    try:
        yield trace
    finally:
        _current.reset(token)


@contextmanager
def step(name: str) -> Iterator[None]:
    """Time a step of the current trace; outside a trace — nothing."""

    trace = _current.get()
    if trace is None:
        yield
        return
    with trace.step(name):
        yield


def note_model(model: str) -> None:
    """Remember which model the current trace called."""

    trace = _current.get()
    if trace is not None:
        trace.model = model


def _ms_since(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


__all__ = [
    "ASSISTANT_OUTCOMES",
    "ASSISTANT_STEPS",
    "AssistantOutcome",
    "Trace",
    "note_model",
    "step",
    "tracing",
]
