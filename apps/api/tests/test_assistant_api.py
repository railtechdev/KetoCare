"""Помощник семьи: ручки, переписка и доступ (раздел 10.4 ТЗ).

Главное здесь не «работает ли», а кто что видит: переписка о ребёнке —
клинические данные, и правило 5 к ней применяется целиком.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from api.services import queue as queue_service
from core.models import AiConversation, AuditLog, IdempotencyKey
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


class TestIdempotency:
    """Ключ повторной отправки (ADR-0035): 202 мог потеряться по дороге."""

    async def _ask_with_key(self, client, parent, patient, auth_headers, key, text):
        return await client.post(
            "/api/v1/ai/assistant/messages",
            json={"patient_id": str(patient.id), "text": text},
            headers={**auth_headers(parent), "Idempotency-Key": key},
        )

    async def _conversations(self, session, patient_id) -> int:
        total = await session.scalar(
            select(func.count())
            .select_from(AiConversation)
            .where(AiConversation.patient_id == patient_id)
        )
        return int(total or 0)

    async def test_repeat_asks_once(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Повтор потерянного ответа: ни второго вопроса, ни второй задачи.

        Дубль здесь дороже, чем у блюда: он виден врачу в переписке и тратит
        дневной бюджет проекта.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        key = "8e03978e-40d5-43e8-bc93-6894a57f9324"

        first = await self._ask_with_key(
            client, parent, patient, auth_headers, key, "куда записать кетоны"
        )
        second = await self._ask_with_key(
            client, parent, patient, auth_headers, key, "куда записать кетоны"
        )

        assert first.status_code == 202, first.text
        assert second.status_code == 202, second.text
        assert second.json() == first.json()
        assert await self._conversations(session, patient.id) == 1
        assert len(enqueued) == 1

    async def test_same_key_with_another_question_is_rejected(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        parent, patient = await _linked_parent(session, make_user, make_patient)
        key = "3f1a1f6c-7a0e-4d0e-9a6e-2f2b0a4c9d11"

        await self._ask_with_key(client, parent, patient, auth_headers, key, "куда записать кетоны")
        other = await self._ask_with_key(
            client, parent, patient, auth_headers, key, "а куда записать вес"
        )

        assert other.status_code == 422, other.text
        assert other.json()["error"]["code"] == "validation_error"
        assert await self._conversations(session, patient.id) == 1
        assert len(enqueued) == 1

    async def test_without_key_each_question_is_new(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Без заголовка ручка работает как раньше: старые клиенты его не шлют."""

        parent, patient = await _linked_parent(session, make_user, make_patient)

        for _ in range(2):
            response = await _ask(client, parent, patient, auth_headers)
            assert response.status_code == 202, response.text

        assert await self._conversations(session, patient.id) == 2
        assert len(enqueued) == 2

    async def test_someone_elses_conversation_does_not_reserve_the_key(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Отказ 404 ключ не занимает: иначе исправленный вопрос не пройдёт."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        stranger, stranger_patient = await _linked_parent(session, make_user, make_patient)
        theirs = await client.post(
            "/api/v1/ai/assistant/messages",
            json={"patient_id": str(stranger_patient.id), "text": "их вопрос"},
            headers=auth_headers(stranger),
        )
        key = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f"

        refused = await client.post(
            "/api/v1/ai/assistant/messages",
            json={
                "patient_id": str(patient.id),
                "conversation_id": theirs.json()["conversation_id"],
                "text": "куда записать кетоны",
            },
            headers={**auth_headers(parent), "Idempotency-Key": key},
        )
        accepted = await self._ask_with_key(
            client, parent, patient, auth_headers, key, "куда записать кетоны"
        )

        assert refused.status_code == 404, refused.text
        assert accepted.status_code == 202, accepted.text

    async def test_queue_failure_does_not_promise_an_answer(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ) -> None:
        """Очередь недоступна: ожидание не висит вечно, а ключ не выдаёт «принято».

        До ключа человек лечил это сам — повтор создавал новый вопрос и новую
        задачу. С ключом повтор вернул бы прежнее «принято» на сутки, а ответа
        не появилось бы никогда: задачи нет и поставить её некому.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        key = "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70"

        async def refuse(task: str, *args) -> None:
            raise RuntimeError("queue is down")

        monkeypatch.setattr(queue_service, "enqueue", refuse)
        failed = await self._ask_with_key(
            client, parent, patient, auth_headers, key, "куда записать кетоны"
        )

        assert failed.status_code == 500, failed.text
        conversation = await session.scalar(
            select(AiConversation).where(AiConversation.patient_id == patient.id)
        )
        assert conversation is not None
        statuses = [message.get("status") for message in conversation.messages or []]
        assert "failed" in statuses and "pending" not in statuses
        left = await session.scalar(
            select(func.count()).select_from(IdempotencyKey).where(IdempotencyKey.key == key)
        )
        assert left == 0

    async def test_forbidden_request_does_not_reserve_the_key(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ) -> None:
        """Отказ 403 ключ не занимает: иначе исправленный вопрос не пройдёт."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        stranger_patient = await make_patient()
        key = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"

        refused = await self._ask_with_key(
            client, parent, stranger_patient, auth_headers, key, "куда записать кетоны"
        )
        accepted = await self._ask_with_key(
            client, parent, patient, auth_headers, key, "куда записать кетоны"
        )

        assert refused.status_code == 403, refused.text
        assert accepted.status_code == 202, accepted.text
        assert len(enqueued) == 1


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

        # Выборка сужена до пациента намеренно. Глобальный `.one()` по всей
        # таблице падал от ЛЮБОЙ строки, попавшей в базу мимо теста, — например
        # от ручной проверки помощника на дев-стенде. Тест про привязку
        # переписки к ребёнку, а не про то, что таблица пуста.
        conversation = (
            await session.scalars(
                select(AiConversation).where(AiConversation.patient_id == patient.id)
            )
        ).one()
        assert conversation.patient_id == patient.id
        assert conversation.user_id == parent.id
