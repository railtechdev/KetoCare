"""«Напомнить семье» — `POST /patients/{id}/family-nudge` (ADR-0046, аудит блокеров C5).

Потребитель — кабинет специалиста (`NudgeFamilyButton`): он читает
`recipients`, `contacts` и `details.previous_at` у отказа 409. Задачу
`notify_family_nudge` и порядок её аргументов читает воркер.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from core.models import AuditLog, FamilyNudge
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

pytestmark = pytest.mark.asyncio


def url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/family-nudge"


async def _care(session, make_user, make_patient, *, role=UserRole.DOCTOR):
    specialist = await make_user(role)
    patient = await make_patient("Амина")
    await patients_repo.link_doctor(session, doctor_id=specialist.id, patient_id=patient.id)
    mother = await make_user(UserRole.PARENT)
    await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
    return specialist, patient, mother


async def _chat(session, *, parent, patient, chat_id: int):
    return await telegram_repo.create_link(
        session, parent_id=parent.id, patient_id=patient.id, chat_id=chat_id, secret="s"
    )


async def test_nudge_goes_to_every_live_chat(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    doctor, patient, mother = await _care(session, make_user, make_patient)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_001)
    second = await _chat(session, parent=mother, patient=patient, chat_id=880_000_002)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_003)
    await telegram_repo.revoke(session, second.id)

    response = await client.post(url(patient.id), headers=auth_headers(doctor))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recipients"] == 2
    assert body["sent_at"] is not None
    assert body["contacts"] == []
    tasks = [args for task, args in enqueued if task == "notify_family_nudge"]
    # Имя ребёнка в задачу не уходит — только кто просит и его роль.
    assert tasks == [(str(patient.id), doctor.full_name, "doctor")]


async def test_dietitian_may_nudge(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    dietitian, patient, mother = await _care(
        session, make_user, make_patient, role=UserRole.DIETITIAN
    )
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_011)

    response = await client.post(url(patient.id), headers=auth_headers(dietitian))

    assert response.status_code == 200, response.text
    assert [args[2] for task, args in enqueued if task == "notify_family_nudge"] == ["dietitian"]


async def test_audited(client, session, make_user, make_patient, auth_headers, enqueued):
    doctor, patient, mother = await _care(session, make_user, make_patient)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_021)

    await client.post(url(patient.id), headers=auth_headers(doctor))

    entry = await session.scalar(
        select(AuditLog).where(AuditLog.action == "family_nudge", AuditLog.entity_id == patient.id)
    )
    assert entry is not None
    assert entry.user_id == doctor.id
    assert entry.after == {"recipients": 1}


async def test_parent_is_refused(client, session, make_user, make_patient, auth_headers, enqueued):
    _, patient, mother = await _care(session, make_user, make_patient)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_031)

    response = await client.post(url(patient.id), headers=auth_headers(mother))

    assert response.status_code == 403
    assert [task for task, _ in enqueued if task == "notify_family_nudge"] == []


async def test_specialist_not_leading_is_refused(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    _, patient, mother = await _care(session, make_user, make_patient)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_041)
    stranger = await make_user(UserRole.DOCTOR)

    response = await client.post(url(patient.id), headers=auth_headers(stranger))

    assert response.status_code == 403


async def test_admin_is_refused(client, session, make_user, make_patient, auth_headers, enqueued):
    """Администратор к семье ребёнка не ходит — это не его пациент."""

    _, patient, mother = await _care(session, make_user, make_patient)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_045)
    admin = await make_user(UserRole.ADMIN)

    response = await client.post(url(patient.id), headers=auth_headers(admin))

    assert response.status_code == 403
    assert [task for task, _ in enqueued if task == "notify_family_nudge"] == []


async def test_malformed_id_is_a_validation_error(client, make_user, auth_headers, enqueued):
    doctor = await make_user(UserRole.DOCTOR)

    response = await client.post(url("not-a-uuid"), headers=auth_headers(doctor))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_second_nudge_within_a_day_is_a_conflict(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    """Предел на ребёнка, а не на специалиста: семья слышит одно напоминание."""

    doctor, patient, mother = await _care(session, make_user, make_patient)
    colleague = await make_user(UserRole.DIETITIAN)
    await patients_repo.link_doctor(session, doctor_id=colleague.id, patient_id=patient.id)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_051)

    first = await client.post(url(patient.id), headers=auth_headers(doctor))
    second = await client.post(url(patient.id), headers=auth_headers(colleague))

    assert first.status_code == 200
    assert second.status_code == 409
    error = second.json()["error"]
    assert error["code"] == "conflict"
    assert error["details"]["reason"] == "nudged_recently"
    previous = datetime.fromisoformat(error["details"]["previous_at"])
    assert previous == datetime.fromisoformat(first.json()["sent_at"])
    assert datetime.fromisoformat(error["details"]["next_at"]) == previous + timedelta(hours=24)
    assert len([task for task, _ in enqueued if task == "notify_family_nudge"]) == 1


async def test_a_day_later_nudging_is_allowed_again(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    doctor, patient, mother = await _care(session, make_user, make_patient)
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_061)
    session.add(
        FamilyNudge(
            patient_id=patient.id,
            requested_by=doctor.id,
            recipients=1,
            created_at=datetime.now(UTC) - timedelta(hours=25),
        )
    )
    await session.flush()

    response = await client.post(url(patient.id), headers=auth_headers(doctor))

    assert response.status_code == 200, response.text


async def test_no_chats_returns_contacts_and_spends_nothing(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    """Telegram нет — отправлять некуда: предел цел, журнал молчит, врач видит контакты."""

    doctor, patient, mother = await _care(session, make_user, make_patient)
    mother.phone = "+998 90 000 00 00"
    telegram_only = await make_user(UserRole.PARENT)
    telegram_only.email = None
    await patients_repo.link_parent(session, parent_id=telegram_only.id, patient_id=patient.id)
    await session.flush()

    response = await client.post(url(patient.id), headers=auth_headers(doctor))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recipients"] == 0
    assert body["sent_at"] is None
    assert body["contacts"] == [
        {"full_name": mother.full_name, "phone": mother.phone, "email": mother.email}
    ]
    assert [task for task, _ in enqueued if task == "notify_family_nudge"] == []
    nudges = await session.scalars(select(FamilyNudge).where(FamilyNudge.patient_id == patient.id))
    assert list(nudges) == []
    audit = await session.scalar(
        select(AuditLog).where(AuditLog.action == "family_nudge", AuditLog.entity_id == patient.id)
    )
    assert audit is None

    # И сразу после — можно, когда семья подключит бота: предел не потрачен.
    await _chat(session, parent=mother, patient=patient, chat_id=880_000_071)
    again = await client.post(url(patient.id), headers=auth_headers(doctor))
    assert again.json()["recipients"] == 1
