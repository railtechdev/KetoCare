"""The clinic's card number on a patient (ADR-0092).

The second identifier, next to the birth date, on every page of a clinical
document. Set by the treating specialist; the family neither sees a field for it
nor can wipe it by saving the profile.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from core.models import AuditLog
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


def card_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/clinic-card"


async def _linked(session, make_user, make_patient, role=UserRole.DOCTOR):
    user = await make_user(role)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=user.id, patient_id=patient.id)
    return user, patient


@pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN])
async def test_specialist_sets_and_clears(
    client, session, make_user, make_patient, auth_headers, role
):
    user, patient = await _linked(session, make_user, make_patient, role)

    response = await client.put(
        card_url(patient.id),
        json={"clinic_card_number": "  А-2026/ 015 "},
        headers=auth_headers(user),
    )

    assert response.status_code == 200, response.text
    assert response.json()["clinic_card_number"] == "А-2026/ 015"

    cleared = await client.put(
        card_url(patient.id), json={"clinic_card_number": ""}, headers=auth_headers(user)
    )
    assert cleared.json()["clinic_card_number"] is None


async def test_change_is_audited_with_the_previous_value(
    client, session, make_user, make_patient, auth_headers
):
    doctor, patient = await _linked(session, make_user, make_patient)
    await client.put(
        card_url(patient.id), json={"clinic_card_number": "0142"}, headers=auth_headers(doctor)
    )
    await client.put(
        card_url(patient.id), json={"clinic_card_number": "0143"}, headers=auth_headers(doctor)
    )
    # Saving the same value again writes nothing.
    await client.put(
        card_url(patient.id), json={"clinic_card_number": "0143"}, headers=auth_headers(doctor)
    )

    entries = (
        await session.scalars(
            select(AuditLog).where(
                AuditLog.entity == "patients",
                AuditLog.entity_id == patient.id,
                AuditLog.action == "update",
            )
        )
    ).all()
    assert sorted((e.before["clinic_card_number"] or "") for e in entries) == ["", "0142"]
    assert all(e.user_id == doctor.id for e in entries)


async def test_number_is_unique_and_the_owner_is_not_named(
    client, session, make_user, make_patient, auth_headers
):
    doctor, first = await _linked(session, make_user, make_patient)
    other_doctor, second = await _linked(session, make_user, make_patient)
    # Read before the refused write: its rollback expires every loaded object.
    first_id, first_name, second_id = first.id, first.full_name, second.id
    await client.put(
        card_url(first_id), json={"clinic_card_number": "0142"}, headers=auth_headers(doctor)
    )

    response = await client.put(
        card_url(second_id),
        json={"clinic_card_number": "0142"},
        headers=auth_headers(other_doctor),
    )

    assert response.status_code == 409
    assert first_name not in response.text
    assert str(first_id) not in response.text
    # The refused write left the card as it was and the session usable.
    again = await client.put(
        card_url(second_id),
        json={"clinic_card_number": "0144"},
        headers=auth_headers(other_doctor),
    )
    assert again.status_code == 200


@pytest.mark.parametrize("value", ["x" * 33, "<script>", "-0142", "01\n42"])
async def test_odd_values_are_refused(
    client, session, make_user, make_patient, auth_headers, value
):
    doctor, patient = await _linked(session, make_user, make_patient)

    response = await client.put(
        card_url(patient.id), json={"clinic_card_number": value}, headers=auth_headers(doctor)
    )

    # A newline is whitespace and is collapsed, so "01\n42" becomes "01 42".
    if value == "01\n42":
        assert response.status_code == 200
        assert response.json()["clinic_card_number"] == "01 42"
    else:
        assert response.status_code == 422


async def test_family_cannot_set_it(client, session, make_user, make_patient, auth_headers):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

    response = await client.put(
        card_url(patient.id), json={"clinic_card_number": "0142"}, headers=auth_headers(parent)
    )

    assert response.status_code == 403


async def test_specialist_without_the_patient_is_refused(
    client, session, make_user, make_patient, auth_headers
):
    stranger = await make_user(UserRole.DOCTOR)
    patient = await make_patient()

    response = await client.put(
        card_url(patient.id), json={"clinic_card_number": "0142"}, headers=auth_headers(stranger)
    )

    assert response.status_code in (403, 404)


async def test_family_profile_save_keeps_the_number(
    client, session, make_user, make_patient, auth_headers
):
    """The family's profile form does not know the number; saving it must not wipe it."""

    doctor, patient = await _linked(session, make_user, make_patient)
    parent = await make_user(UserRole.PARENT)
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    await client.put(
        card_url(patient.id), json={"clinic_card_number": "0142"}, headers=auth_headers(doctor)
    )

    response = await client.patch(
        f"/api/v1/patients/{patient.id}",
        json={"full_name": patient.full_name, "height_cm": 112, "allergies": []},
        headers=auth_headers(parent),
    )

    assert response.status_code == 200, response.text
    assert response.json()["clinic_card_number"] == "0142"


async def test_set_when_the_card_is_created(client, session, make_user, auth_headers):
    doctor = await make_user(UserRole.DOCTOR)

    response = await client.post(
        "/api/v1/patients",
        json={
            "full_name": "Тестовый Ребёнок",
            "birth_date": date(2020, 3, 12).isoformat(),
            "sex": "f",
            "clinic_card_number": "0150",
        },
        headers=auth_headers(doctor),
    )

    assert response.status_code == 201, response.text
    assert response.json()["clinic_card_number"] == "0150"

    duplicate = await client.post(
        "/api/v1/patients",
        json={
            "full_name": "Другой Ребёнок",
            "birth_date": date(2019, 1, 2).isoformat(),
            "sex": "m",
            "clinic_card_number": "0150",
        },
        headers=auth_headers(doctor),
    )
    assert duplicate.status_code == 409
