"""Помощник семьи: ручки, переписка и доступ (раздел 10.4 ТЗ).

Главное здесь не «работает ли», а кто что видит: переписка о ребёнке —
клинические данные, и правило 5 к ней применяется целиком.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from core.models import AiConversation, AuditLog
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _ask(client, parent, patient, auth_headers, text="куда записать кетоны"):
    return await client.post(
        "/api/v1/ai/assistant/messages",
        json={"patient_id": str(patient.id), "text": text},
        headers=auth_headers(parent),
    )


class TestAsking:
    async def test_question_is_accepted_and_queued(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """202 и задача в очереди: ответ дописывает воркер, а ручка столько не
        ждёт — nginx рвёт соединение на шестидесятой секунде (ADR-0022)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)

        response = await _ask(client, parent, patient, auth_headers)

        assert response.status_code == 202
        body = response.json()
        assert body["question_seq"] == 0
        assert body["reply_seq"] == 1

        task, args = enqueued[0]
        assert task == "assistant_reply"
        assert args[1] == str(parent.id)
        assert args[3] == "куда записать кетоны"

    async def test_pending_reply_appears_immediately(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Пустое «ожидание» кладётся сразу: иначе экран показывает пустоту, из
        которой непонятно, ушёл ли вопрос вообще."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        read = await client.get(
            f"/api/v1/patients/{patient.id}/ai-conversations/{accepted['conversation_id']}",
            headers=auth_headers(parent),
        )

        messages = read.json()["messages"]
        assert [m["role"] for m in messages] == ["user", "assistant"]
        assert messages[1]["status"] == "pending"
        assert messages[1]["text"] == ""

    async def test_someone_elses_child_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        parent = await make_user(UserRole.PARENT)
        other = await make_patient("Чужой Ребёнок")

        response = await _ask(client, parent, other, auth_headers)

        assert response.status_code == 403
        assert enqueued == []

    async def test_specialist_does_not_write_on_behalf_of_the_family(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Врач читает переписку, но не ведёт её: иначе в карте появились бы
        вопросы, которых семья не задавала."""

        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await _ask(client, doctor, patient, auth_headers)

        assert response.status_code == 403
        assert enqueued == []

    async def test_continuing_someone_elses_conversation_is_not_found(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        parent, patient = await _linked_parent(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=stranger.id, patient_id=patient.id)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        response = await client.post(
            "/api/v1/ai/assistant/messages",
            json={
                "patient_id": str(patient.id),
                "conversation_id": accepted["conversation_id"],
                "text": "а ещё вопрос",
            },
            headers=auth_headers(stranger),
        )

        assert response.status_code == 404


class TestReading:
    async def test_parent_sees_only_own_conversations(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Переписка личная: второй родитель того же ребёнка её не читает."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        second = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=second.id, patient_id=patient.id)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        listing = await client.get(
            f"/api/v1/patients/{patient.id}/ai-conversations", headers=auth_headers(second)
        )
        one = await client.get(
            f"/api/v1/patients/{patient.id}/ai-conversations/{accepted['conversation_id']}",
            headers=auth_headers(second),
        )

        assert listing.json()["total"] == 0
        assert one.status_code == 404

    async def test_doctor_reads_and_the_read_is_recorded(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Раздел 10.4 открывает переписку врачу; правило 7 требует следа."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/ai-conversations/{accepted['conversation_id']}",
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200
        entries = list(
            await session.scalars(select(AuditLog).where(AuditLog.action == "ai_conversation.read"))
        )
        assert [entry.user_id for entry in entries] == [doctor.id]

    async def test_admin_has_no_access(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Администратор к клиническим данным доступа не имеет (правило 5)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        admin = await make_user(UserRole.ADMIN)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/ai-conversations/{accepted['conversation_id']}",
            headers=auth_headers(admin),
        )

        assert response.status_code == 403

    async def test_polling_returns_only_new_messages(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Экран дочитывает переписку, а не перечитывает её целиком."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/ai-conversations/{accepted['conversation_id']}"
            "?after_seq=0",
            headers=auth_headers(parent),
        )

        assert [m["seq"] for m in response.json()["messages"]] == [1]

    async def test_conversation_of_another_patient_is_not_found(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Идентификатор разговора не должен открывать его через чужого ребёнка."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        other = await make_patient("Второй Ребёнок")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=other.id)
        accepted = (await _ask(client, parent, patient, auth_headers)).json()

        response = await client.get(
            f"/api/v1/patients/{other.id}/ai-conversations/{accepted['conversation_id']}",
            headers=auth_headers(parent),
        )

        assert response.status_code == 404


class TestStorage:
    async def test_conversation_is_bound_to_the_child(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Без `patient_id` переписку не удалит `erase_patient` (ADR-0019), а
        врач не увидит переписку своего пациента."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        await _ask(client, parent, patient, auth_headers)

        conversation = (await session.scalars(select(AiConversation))).one()
        assert conversation.patient_id == patient.id
        assert conversation.user_id == parent.id
