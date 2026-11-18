"""A save that repeats the prescription in force writes nothing and tells no one.

UI audit of 2026-11-18: the prescription form is always open, and pressing
"Save" without a change added a copy to the history and sent the family a
Telegram message about a new prescription.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select

from core.clock import local_today
from core.models import Prescription
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

BASE = {
    "ratio": 3.5,
    "kcal_per_day": 1200,
    "protein_g": 22.0,
    "carbs_limit_g": 10.0,
    "meals_per_day": 4,
    "restrictions": "без глютена",
}


async def _setup(session, make_user, make_patient):
    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    return doctor, patient


async def _versions(session, patient_id) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(Prescription)
            .where(Prescription.patient_id == patient_id)
        )
    )


async def _post(client, auth_headers, doctor, patient, **changes):
    body = {**BASE, "effective_from": local_today().isoformat(), **changes}
    return await client.post(
        f"/api/v1/patients/{patient.id}/prescriptions", json=body, headers=auth_headers(doctor)
    )


async def test_same_values_are_refused_and_the_family_is_not_told(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    doctor, patient = await _setup(session, make_user, make_patient)
    assert (await _post(client, auth_headers, doctor, patient)).status_code == 201
    enqueued.clear()

    # Restrictions differ only by surrounding spaces: the same text to a person.
    response = await _post(client, auth_headers, doctor, patient, restrictions=" без глютена ")

    assert response.status_code == 409, response.text
    body = response.json()["error"]
    assert body["code"] == "conflict"
    assert body["details"]["reason"] == "unchanged"
    assert "не изменилось" in body["message"]
    assert await _versions(session, patient.id) == 1
    assert not [task for task, _ in enqueued if task == "notify_family"]


async def test_same_values_from_a_later_date_are_still_the_same(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    doctor, patient = await _setup(session, make_user, make_patient)
    assert (await _post(client, auth_headers, doctor, patient)).status_code == 201

    later = (local_today() + timedelta(days=3)).isoformat()
    response = await _post(client, auth_headers, doctor, patient, effective_from=later)

    assert response.status_code == 409
    assert await _versions(session, patient.id) == 1


async def test_any_changed_value_is_a_new_version(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    doctor, patient = await _setup(session, make_user, make_patient)
    assert (await _post(client, auth_headers, doctor, patient)).status_code == 201

    for changes in (
        {"kcal_per_day": 1250},
        {"meals_per_day": 5},
        {"restrictions": None},
        {"fluid_ml_per_day": 1000},
    ):
        response = await _post(client, auth_headers, doctor, patient, **changes)
        assert response.status_code == 201, (changes, response.text)


async def test_returning_to_old_values_over_a_later_version_is_allowed(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    """Undoing a change is a change: the version in force on that date differs."""

    doctor, patient = await _setup(session, make_user, make_patient)
    assert (await _post(client, auth_headers, doctor, patient)).status_code == 201
    assert (
        await _post(client, auth_headers, doctor, patient, kcal_per_day=1300)
    ).status_code == 201

    response = await _post(client, auth_headers, doctor, patient)

    assert response.status_code == 201, response.text
    assert await _versions(session, patient.id) == 3


async def test_cancelling_a_future_version_with_current_values_is_allowed(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    """A in force, B written to start later; A's values again from today cancel B."""

    doctor, patient = await _setup(session, make_user, make_patient)
    assert (await _post(client, auth_headers, doctor, patient)).status_code == 201
    later = (local_today() + timedelta(days=7)).isoformat()
    future = await _post(
        client, auth_headers, doctor, patient, kcal_per_day=1300, effective_from=later
    )
    assert future.status_code == 201
    enqueued.clear()

    response = await _post(client, auth_headers, doctor, patient)

    assert response.status_code == 201, response.text
    assert [task for task, _ in enqueued if task == "notify_family"]
    upcoming = await client.get(
        f"/api/v1/patients/{patient.id}/prescriptions/on",
        params={"date": later},
        headers=auth_headers(doctor),
    )
    assert upcoming.json()["prescription"]["kcal_per_day"] == 1200


async def test_back_dated_return_to_old_values_is_allowed(
    client, session, make_user, make_patient, auth_headers, enqueued
):
    """A from day -10, B from day -3; A's values from day -6 correct the past."""

    doctor, patient = await _setup(session, make_user, make_patient)
    first = (local_today() - timedelta(days=10)).isoformat()
    second = (local_today() - timedelta(days=3)).isoformat()
    assert (
        await _post(client, auth_headers, doctor, patient, effective_from=first)
    ).status_code == 201
    assert (
        await _post(client, auth_headers, doctor, patient, kcal_per_day=1300, effective_from=second)
    ).status_code == 201

    correction = (local_today() - timedelta(days=6)).isoformat()
    response = await _post(client, auth_headers, doctor, patient, effective_from=correction)

    assert response.status_code == 201, response.text
