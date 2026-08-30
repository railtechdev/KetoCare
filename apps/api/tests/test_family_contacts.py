"""Контакты семьи у специалиста (ADR-0011).

Тесты безопасности не меньше, чем функциональности: ручка отдаёт персональные
данные взрослого — телефон и почту родителя, — и её единственная защита это
требование иметь доступ к ребёнку.
"""

from __future__ import annotations

import uuid

import pytest

from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


def parents_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/parents"


class TestFamilyContacts:
    async def test_doctor_of_patient_sees_name_and_contacts(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        parent.phone = "+998901234567"
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        await session.flush()

        response = await client.get(parents_url(patient.id), headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body) == 1
        # Флаг «семья молчит» должен иметь продолжение: без контактов триаж
        # заканчивается констатацией проблемы.
        assert body[0]["full_name"] == parent.full_name
        assert body[0]["phone"] == "+998901234567"
        assert body[0]["email"] == parent.email

    async def test_secrets_do_not_leak(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.get(parents_url(patient.id), headers=auth_headers(doctor))

        card = response.json()[0]
        assert set(card) == {"id", "full_name", "phone", "email"}

    async def test_two_parents_both_listed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        mother = await make_user(UserRole.PARENT)
        father = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        await patients_repo.link_parent(session, parent_id=father.id, patient_id=patient.id)

        response = await client.get(parents_url(patient.id), headers=auth_headers(doctor))

        # Связь многие-ко-многим (раздел 4.2): у ребёнка бывает двое родителей с
        # отдельными кабинетами, и молчать может один из них.
        assert {item["id"] for item in response.json()} == {str(mother.id), str(father.id)}

    async def test_foreign_doctor_denied(
        self, client, session, make_user, make_patient, auth_headers
    ):
        stranger = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        # Врач без доступа к ребёнку не получает и контактов его семьи: иначе
        # список пациентов клиники превращался бы в справочник родителей.
        response = await client.get(parents_url(patient.id), headers=auth_headers(stranger))

        assert response.status_code == 403

    async def test_admin_denied(self, client, session, make_user, make_patient, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        # Администратор к данным пациента доступа не имеет (правило 5).
        response = await client.get(parents_url(patient.id), headers=auth_headers(admin))

        assert response.status_code == 403

    async def test_parent_sees_the_other_parent(
        self, client, session, make_user, make_patient, auth_headers
    ):
        mother = await make_user(UserRole.PARENT)
        father = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=mother.id, patient_id=patient.id)
        await patients_repo.link_parent(session, parent_id=father.id, patient_id=patient.id)

        # Симметрия с `/doctors`, открытой семье: там родитель узнаёт, кто из
        # специалистов видит данные ребёнка, здесь — кто ведёт его дома.
        response = await client.get(parents_url(patient.id), headers=auth_headers(mother))

        assert response.status_code == 200
        assert {item["id"] for item in response.json()} == {str(mother.id), str(father.id)}

    async def test_unknown_patient_denied(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)

        response = await client.get(parents_url(uuid.uuid4()), headers=auth_headers(doctor))

        assert response.status_code == 403
