"""`POST /ai/parse` и подтверждение разбора (раздел 10.3 ТЗ, п. 19 этапа 4).

Ручка ничего не сохраняет: она отдаёт черновик. Запись появляется отдельным
запросом с `ai_job_id` — и здесь проверяется главным образом то, что подсунуть
под видом разбора чужие или выдуманные данные нельзя.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import queue as queue_service
from core.models import AiJob, MealLog
from core.models.enums import AiJobKind, AiJobStatus, UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

#: Идентификатор продукта — настоящий UUID: ручка объявляет его типом, и
#: строка «a1» из промпта до неё не доходит (проверка на границе, а не на веру).
PRODUCT_ID = "3f2a1c9d-1111-4111-8111-222222222222"

PARSED = {
    "kind": "meal",
    "meal": {
        "items": [{"product_id": PRODUCT_ID, "grams": 30.0, "confidence": 1.0}],
        "unmatched": [],
    },
    "seizure": None,
    "clarification_needed": None,
}


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


def _answers(monkeypatch, envelope, *, recorder: list | None = None):
    async def run(task: str, *args, timeout_s: float):
        if recorder is not None:
            recorder.append((task, args, timeout_s))
        if isinstance(envelope, Exception):
            raise envelope
        return envelope

    monkeypatch.setattr(queue_service, "run", run)


async def _job(
    session: AsyncSession,
    *,
    requested_by,
    patient_id,
    kind: AiJobKind = AiJobKind.PARSE_MEAL,
    status: AiJobStatus = AiJobStatus.DONE,
    output: dict | None = None,
) -> AiJob:
    job = AiJob(
        kind=kind,
        status=status,
        requested_by=requested_by,
        patient_id=patient_id,
        input={},
        model="claude-haiku-4-5",
        output=output if output is not None else {"text": "…", "parsed": PARSED},
        finished_at=datetime.now(UTC),
    )
    session.add(job)
    await session.flush()
    return job


class TestParse:
    async def test_returns_a_draft_and_saves_nothing(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ) -> None:
        parent, patient = await _linked_parent(session, make_user, make_patient)
        job_id = uuid.uuid4()
        _answers(monkeypatch, {"status": "ok", "ai_job_id": str(job_id), "result": PARSED})

        response = await client.post(
            "/api/v1/ai/parse",
            json={"patient_id": str(patient.id), "text": "30 г масла"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["ai_job_id"] == str(job_id)
        assert body["meal"]["items"][0]["grams"] == 30.0
        # Разбор — черновик: дневник остаётся пустым до подтверждения.
        assert list(await session.scalars(select(MealLog))) == []

    async def test_someone_elses_child_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ) -> None:
        parent = await make_user(UserRole.PARENT)
        other = await make_patient("Чужой Ребёнок")
        _answers(monkeypatch, {"status": "ok", "ai_job_id": str(uuid.uuid4()), "result": PARSED})

        response = await client.post(
            "/api/v1/ai/parse",
            json={"patient_id": str(other.id), "text": "30 г масла"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403

    async def test_empty_text_is_a_validation_error(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await client.post(
            "/api/v1/ai/parse",
            json={"patient_id": str(patient.id), "text": ""},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422

    async def test_limit_becomes_rate_limited(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ) -> None:
        """Предел и бюджет — это `rate_limited`, а не «сломалось»: человеку надо
        сказать «на сегодня хватит», а не предлагать повтор (раздел 10.2 ТЗ)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        _answers(monkeypatch, {"status": "limited", "message": "На сегодня вопросов больше нет."})

        response = await client.post(
            "/api/v1/ai/parse",
            json={"patient_id": str(patient.id), "text": "30 г масла"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "rate_limited"

    async def test_timeout_degrades_softly(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ) -> None:
        """503, а не 500: клиент отличает «сейчас не получится» от «сломано», и
        от этого зависит, предлагать ли повтор (раздел 10.2 ТЗ)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        _answers(monkeypatch, queue_service.TaskTimeout("не успела"))

        response = await client.post(
            "/api/v1/ai/parse",
            json={"patient_id": str(patient.id), "text": "30 г масла"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 503

    async def test_task_gets_the_user_and_the_timeout(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ) -> None:
        """Задача считает вызов на того, кто спросил: по этому же полю считается
        суточный предел."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        calls: list = []
        _answers(
            monkeypatch,
            {"status": "ok", "ai_job_id": str(uuid.uuid4()), "result": PARSED},
            recorder=calls,
        )

        await client.post(
            "/api/v1/ai/parse",
            json={"patient_id": str(patient.id), "text": "30 г масла"},
            headers=auth_headers(parent),
        )

        task, args, timeout = calls[0]
        assert task == "parse_free_text"
        assert args == (str(parent.id), str(patient.id), "30 г масла")
        assert timeout == 15.0


class TestConfirmation:
    async def test_confirmed_parse_is_copied_from_the_journal(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        parent, patient = await _linked_parent(session, make_user, make_patient)
        job = await _job(session, requested_by=parent.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/meals",
            json={
                "occurred_at": "2026-09-02T09:00:00Z",
                "free_text": "30 г масла",
                "ai_job_id": str(job.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 201
        assert response.json()["parsed"] == PARSED

    async def test_someone_elses_job_is_not_found(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        """Чужой разбор нельзя ни применить, ни отличить от несуществующего:
        по разнице ответов устанавливалось бы, что он существует."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)
        job = await _job(session, requested_by=stranger.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/meals",
            json={
                "occurred_at": "2026-09-02T09:00:00Z",
                "free_text": "30 г масла",
                "ai_job_id": str(job.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 404
        assert list(await session.scalars(select(MealLog))) == []

    async def test_job_about_another_child_is_not_found(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        """Иначе разбор одного ребёнка попал бы в дневник другого — с его
        граммовкой в расчёте кетосоотношения."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        other = await make_patient("Второй Ребёнок")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=other.id)
        job = await _job(session, requested_by=parent.id, patient_id=other.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/meals",
            json={
                "occurred_at": "2026-09-02T09:00:00Z",
                "free_text": "30 г масла",
                "ai_job_id": str(job.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 404

    async def test_unfinished_job_is_not_confirmable(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        parent, patient = await _linked_parent(session, make_user, make_patient)
        job = await _job(
            session,
            requested_by=parent.id,
            patient_id=patient.id,
            status=AiJobStatus.FAILED,
            output={"text": "…"},
        )

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/meals",
            json={
                "occurred_at": "2026-09-02T09:00:00Z",
                "free_text": "30 г масла",
                "ai_job_id": str(job.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 404

    async def test_client_cannot_send_parsed_itself(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        """`parsed` телом не принимается: иначе клиент прислал бы любые граммы и
        любые продукты под видом разбора (правило 6 CLAUDE.md)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/meals",
            json={
                "occurred_at": "2026-09-02T09:00:00Z",
                "free_text": "30 г масла",
                "parsed": {"kind": "meal", "meal": {"items": [], "unmatched": []}},
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 422

    async def test_meal_without_a_job_still_works(
        self, client, session, make_user, make_patient, auth_headers
    ) -> None:
        """Запись руками остаётся возможной: разбор — это удобство, а не
        единственный путь."""

        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/meals",
            json={"occurred_at": "2026-09-02T09:00:00Z", "free_text": "омлет"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 201
        assert response.json()["parsed"] is None
