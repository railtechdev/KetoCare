"""The assistant leaves a trace of its steps (ADR-0094) — durations, nothing else."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from core import ai_trace
from core.models import AiTrace
from core.models.enums import AiConversationChannel, AiJobKind
from core.repositories import ai_conversations as conversations_repo
from core.schemas.ai_conversations import new_message
from worker.ai.assistant import Answer, assistant_reply
from worker.ai.client import AiError

QUESTION = "куда записать кетоны"


async def _conversation(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
) -> uuid.UUID:
    async with sessionmaker() as session:
        conversation = await conversations_repo.create(
            session, user_id=user_id, patient_id=patient_id, channel=AiConversationChannel.WEB
        )
        await conversations_repo.append(
            session,
            conversation=conversation,
            messages=[
                new_message(seq=0, role="user", text=QUESTION),
                new_message(seq=1, role="assistant", status="pending"),
            ],
        )
        await session.commit()
        return conversation.id


async def _reply(
    monkeypatch,
    sessionmaker: async_sessionmaker,
    user_id: uuid.UUID,
    patient_id: uuid.UUID,
    outcome: Answer | Exception,
    ctx: dict[str, object] | None = None,
) -> uuid.UUID:
    conversation_id = await _conversation(sessionmaker, user_id, patient_id)

    async def fake_answer(*args: object, **kwargs: object) -> Answer:
        with ai_trace.step("search"):
            pass
        if isinstance(outcome, Exception):
            raise outcome
        if outcome.ai_job_id is not None:
            ai_trace.note_model("anthropic/smart")
            with ai_trace.step("model"):
                pass
        return outcome

    monkeypatch.setattr("worker.ai.assistant.answer", fake_answer)
    monkeypatch.setattr("worker.ai.client.build_ai_client", lambda: None)
    monkeypatch.setattr("core.db.get_sessionmaker", lambda: sessionmaker)

    await assistant_reply(
        ctx or {}, str(conversation_id), str(user_id), str(patient_id), QUESTION, 1
    )
    return conversation_id


async def _traces(sessionmaker: async_sessionmaker) -> list[AiTrace]:
    async with sessionmaker() as session:
        return list((await session.scalars(select(AiTrace))).all())


async def test_an_answer_leaves_its_steps(monkeypatch, sessionmaker, user_id, patient_id) -> None:
    enqueued = datetime.now(UTC) - timedelta(seconds=2)

    await _reply(
        monkeypatch,
        sessionmaker,
        user_id,
        patient_id,
        Answer(text="Кнопка «Кетоны».", ai_job_id=uuid.uuid4()),
        ctx={"enqueue_time": enqueued},
    )

    [trace] = await _traces(sessionmaker)
    assert trace.kind == AiJobKind.ASSISTANT
    assert trace.outcome == "answered"
    assert trace.model == "anthropic/smart"
    assert {"queue", "search", "model", "save"} <= set(trace.steps)
    # Only known step names — never a piece of the question or the answer.
    assert set(trace.steps) <= set(ai_trace.ASSISTANT_STEPS)
    assert trace.steps["queue"] >= 1900
    assert trace.total_ms >= trace.steps["queue"]


async def test_outcomes_tell_where_the_answer_stopped(
    monkeypatch, sessionmaker, user_id, patient_id
) -> None:
    cases: list[Answer | Exception] = [
        Answer(text="—", blocked=True, no_material=True),
        Answer(text="—", blocked=True),
        Answer(text="—", blocked=True, ai_job_id=uuid.uuid4()),
        AiError("provider down"),
    ]
    for case in cases:
        await _reply(monkeypatch, sessionmaker, user_id, patient_id, case)

    traces = await _traces(sessionmaker)
    assert sorted(trace.outcome for trace in traces) == sorted(
        ["no_material", "refused_question", "refused_answer", "failed"]
    )
    # Without the queue stamp the total is the worker's own time.
    assert all("queue" not in trace.steps for trace in traces)


async def test_a_lost_trace_does_not_lose_the_answer(
    monkeypatch, sessionmaker, user_id, patient_id
) -> None:
    async def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr("core.repositories.ai_traces.add", broken)

    conversation_id = await _reply(
        monkeypatch, sessionmaker, user_id, patient_id, Answer(text="Кнопка «Кетоны».")
    )

    async with sessionmaker() as session:
        conversation = await conversations_repo.get(session, conversation_id)
        assert conversation is not None
        reply = {m.seq: m for m in conversations_repo.messages_of(conversation)}[1]
    assert (reply.status, reply.text) == ("done", "Кнопка «Кетоны».")
