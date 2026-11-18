"""Correcting a child's birth date and sex (ADR-0090, UI audit of 2026-11-18, Р1).

A typo in the birth date used to be a dead end: the card cannot be deleted and
the wrong age fed every calculation. Only the treating doctor corrects it, and
every correction is audited with the previous values.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from core.models import AuditLog
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


def identity_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/identity"


async def _linked(session, make_user, make_patient, role=UserRole.DOCTOR):
    user = await make_user(role)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=user.id, patient_id=patient.id)
    return user, patient


async def test_doctor_corrects_and_audit_keeps_previous_values(
    client, session, make_user, make_patient, auth_headers
):
    doctor, patient = await _linked(session, make_user, make_patient)
    previous = patient.birth_date.isoformat()
    corrected = date(2021, 3, 14)
    sex = "f" if str(patient.sex) == "m" else "m"

    response = await client.put(
        identity_url(patient.id),
        json={"birth_date": corrected.isoformat(), "sex": sex},
        headers=auth_headers(doctor),
    )

    assert response.status_code == 200, response.text
    assert response.json()["birth_date"] == corrected.isoformat()
    assert response.json()["sex"] == sex

    entry = await session.scalar(
        select(AuditLog).where(
            AuditLog.entity == "patients",
            AuditLog.entity_id == patient.id,
            AuditLog.action == "correct_identity",
        )
    )
    assert entry is not None
    assert entry.user_id == doctor.id
    assert entry.before["birth_date"] == previous
    assert entry.after == {"birth_date": corrected.isoformat(), "sex": sex}


async def test_same_values_write_no_audit(client, session, make_user, make_patient, auth_headers):
    doctor, patient = await _linked(session, make_user, make_patient)

    response = await client.put(
        identity_url(patient.id),
        json={"birth_date": patient.birth_date.isoformat(), "sex": str(patient.sex)},
        headers=auth_headers(doctor),
    )

    assert response.status_code == 200, response.text
    entry = await session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == patient.id, AuditLog.action == "correct_identity"
        )
    )
    assert entry is None


async def test_future_birth_date_is_refused(client, session, make_user, make_patient, auth_headers):
    doctor, patient = await _linked(session, make_user, make_patient)

    response = await client.put(
        identity_url(patient.id),
        json={
            "birth_date": (date.today() + timedelta(days=400)).isoformat(),
            "sex": str(patient.sex),
        },
        headers=auth_headers(doctor),
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("role", [UserRole.DIETITIAN, UserRole.PARENT])
async def test_only_the_doctor_corrects(
    client, session, make_user, make_patient, auth_headers, role
):
    user = await make_user(role)
    patient = await make_patient()
    if role == UserRole.PARENT:
        await patients_repo.link_parent(session, parent_id=user.id, patient_id=patient.id)
    else:
        await patients_repo.link_doctor(session, doctor_id=user.id, patient_id=patient.id)

    response = await client.put(
        identity_url(patient.id),
        json={"birth_date": "2020-01-01", "sex": "m"},
        headers=auth_headers(user),
    )

    assert response.status_code == 403, response.text


async def test_doctor_without_access_is_refused(client, make_user, make_patient, auth_headers):
    stranger = await make_user(UserRole.DOCTOR)
    patient = await make_patient()

    response = await client.put(
        identity_url(patient.id),
        json={"birth_date": "2020-01-01", "sex": "m"},
        headers=auth_headers(stranger),
    )

    assert response.status_code in (403, 404), response.text


async def test_profile_patch_still_ignores_birth_date(
    client, session, make_user, make_patient, auth_headers
):
    doctor, patient = await _linked(session, make_user, make_patient)
    previous = patient.birth_date.isoformat()

    response = await client.patch(
        f"/api/v1/patients/{patient.id}",
        json={"full_name": patient.full_name, "birth_date": "2019-01-01"},
        headers=auth_headers(doctor),
    )

    assert response.status_code == 200, response.text
    assert response.json()["birth_date"] == previous


async def test_birth_date_after_therapy_start_is_refused(
    client, session, make_user, make_patient, auth_headers
):
    # Safety review 2026-11-18: therapy cannot start before birth, and a corrected
    # date past the start left every later medical-profile save failing.
    from core.repositories import medical_profiles as profiles_repo

    doctor, patient = await _linked(session, make_user, make_patient)
    await profiles_repo.upsert(
        session,
        patient_id=patient.id,
        diagnosis=None,
        epilepsy_type=None,
        onset_age_months=None,
        genetics=None,
        comorbidities=None,
        therapy_started_on=date(2024, 5, 1),
    )

    response = await client.put(
        identity_url(patient.id),
        json={"birth_date": "2024-09-01", "sex": str(patient.sex)},
        headers=auth_headers(doctor),
    )

    assert response.status_code == 422, response.text
    assert "01.05.2024" in response.json()["error"]["message"]
