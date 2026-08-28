"""Кто ведёт пациента: привязка специалистов и заведение семьи (ADR-0003).

Это тесты безопасности не меньше, чем функциональности: ручка передачи пациента
раздаёт доступ к клиническим данным, и её единственная защита — требование уже
иметь этот доступ.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from core.models import AuditLog, User
from core.models.enums import UserRole
from core.repositories import invitations as invitations_repo
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

COLLEAGUES_URL = "/api/v1/users/colleagues"
INVITATIONS_URL = "/api/v1/auth/invitations"


def doctors_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/doctors"


class TestColleaguesDirectory:
    async def test_care_roles_see_active_specialists(
        self, client, session, make_user, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        dietitian = await make_user(UserRole.DIETITIAN)
        await make_user(UserRole.PARENT)

        response = await client.get(COLLEAGUES_URL, headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        roles = {item["role"] for item in response.json()}
        assert roles <= {"doctor", "dietitian"}, "родителей в справочнике персонала быть не должно"
        assert {str(doctor.id), str(dietitian.id)} <= {item["id"] for item in response.json()}

    async def test_hides_deactivated_specialist(self, client, session, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        fired = await make_user(UserRole.DOCTOR, is_active=False)

        response = await client.get(COLLEAGUES_URL, headers=auth_headers(doctor))

        assert str(fired.id) not in {item["id"] for item in response.json()}

    @pytest.mark.parametrize("role", [UserRole.PARENT, UserRole.ADMIN])
    async def test_closed_for_other_roles(self, client, make_user, auth_headers, role):
        user = await make_user(role)
        assert (await client.get(COLLEAGUES_URL, headers=auth_headers(user))).status_code == 403

    async def test_requires_authentication(self, client):
        assert (await client.get(COLLEAGUES_URL)).status_code == 401


class TestCareTeam:
    async def test_doctor_hands_patient_to_colleague(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        colleague = await make_user(UserRole.DIETITIAN)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            doctors_url(patient.id),
            json={"doctor_id": str(colleague.id)},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 201, response.text
        assert {item["id"] for item in response.json()} == {str(doctor.id), str(colleague.id)}

        # Коллега действительно получил доступ, а не только строку в ответе.
        seen = await client.get(f"/api/v1/patients/{patient.id}", headers=auth_headers(colleague))
        assert seen.status_code == 200

    async def test_stranger_cannot_grant_access_to_himself(
        self, client, session, make_user, make_patient, auth_headers
    ):
        # Главное свойство ручки: она не должна быть способом получить доступ к
        # чужому пациенту. Врач, не ведущий его, не проходит дальше 403.
        stranger = await make_user(UserRole.DOCTOR)
        patient = await make_patient()

        response = await client.post(
            doctors_url(patient.id),
            json={"doctor_id": str(stranger.id)},
            headers=auth_headers(stranger),
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"
        assert await patients_repo.list_doctor_ids(session, patient_id=patient.id) == []

    async def test_parent_cannot_grant_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.post(
            doctors_url(patient.id),
            json={"doctor_id": str(doctor.id)},
            headers=auth_headers(parent),
        )
        assert response.status_code == 403

    async def test_parent_sees_who_leads_his_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.get(doctors_url(patient.id), headers=auth_headers(parent))

        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()] == [str(doctor.id)]

    async def test_rejects_parent_as_specialist(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            doctors_url(patient.id),
            json={"doctor_id": str(parent.id)},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 404

    async def test_repeated_grant_is_not_an_error(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        colleague = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        body = {"doctor_id": str(colleague.id)}
        first = await client.post(doctors_url(patient.id), json=body, headers=auth_headers(doctor))
        second = await client.post(doctors_url(patient.id), json=body, headers=auth_headers(doctor))

        assert first.status_code == 201
        assert second.status_code == 201, "повтор — это состояние, которого добивался вызов"
        assert len(second.json()) == 2

    async def test_grant_and_revoke_are_audited(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        colleague = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        await client.post(
            doctors_url(patient.id),
            json={"doctor_id": str(colleague.id)},
            headers=auth_headers(doctor),
        )
        await client.delete(
            f"{doctors_url(patient.id)}/{colleague.id}", headers=auth_headers(doctor)
        )

        rows = list(
            await session.scalars(
                select(AuditLog)
                .where(AuditLog.entity == "doctor_patient")
                .order_by(AuditLog.action)
            )
        )
        assert {r.action for r in rows} == {"grant_patient_access", "revoke_patient_access"}
        assert all(r.entity_id == patient.id for r in rows)


class TestRevoke:
    async def test_last_specialist_cannot_be_removed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        # Ручки «взять пациента» нет намеренно, поэтому пациент без ведущего
        # остался бы без него навсегда.
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.delete(
            f"{doctors_url(patient.id)}/{doctor.id}", headers=auth_headers(doctor)
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"
        assert await patients_repo.list_doctor_ids(session, patient_id=patient.id) == [doctor.id]

    async def test_revoke_keeps_clinical_data(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        successor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        await patients_repo.link_doctor(session, doctor_id=successor.id, patient_id=patient.id)

        await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json={
                "ratio": 4.0,
                "kcal_per_day": 1200,
                "protein_g": 25.0,
                "carbs_limit_g": 10.0,
                "meals_per_day": 3,
                "effective_from": "2026-01-01",
            },
            headers=auth_headers(doctor),
        )
        removed = await client.delete(
            f"{doctors_url(patient.id)}/{doctor.id}", headers=auth_headers(doctor)
        )
        assert removed.status_code == 204

        # Назначение осталось: снимается доступ, а не история пациента.
        history = await client.get(
            f"/api/v1/patients/{patient.id}/prescriptions", headers=auth_headers(successor)
        )
        assert history.json()["total"] == 1

        # А снявший себя врач пациента больше не видит.
        assert (
            await client.get(f"/api/v1/patients/{patient.id}", headers=auth_headers(doctor))
        ).status_code == 403

    async def test_unknown_specialist_gives_404(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.delete(
            f"{doctors_url(patient.id)}/{uuid.uuid4()}", headers=auth_headers(doctor)
        )
        assert response.status_code == 404


class TestWhoInvitesWhom:
    async def test_admin_cannot_invite_family(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.post(
            INVITATIONS_URL,
            json={"email": "family@example.com", "role": "parent"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_doctor_cannot_invite_staff(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        response = await client.post(
            INVITATIONS_URL,
            json={"email": "colleague@example.com", "role": "doctor"},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 403

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN])
    async def test_specialist_invites_family(self, client, make_user, auth_headers, role):
        specialist = await make_user(role)
        response = await client.post(
            INVITATIONS_URL,
            json={"email": f"family-{uuid.uuid4().hex[:8]}@example.com", "role": "parent"},
            headers=auth_headers(specialist),
        )
        assert response.status_code == 201, response.text

    async def test_parent_cannot_invite(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            INVITATIONS_URL,
            json={"email": "someone@example.com", "role": "parent"},
            headers=auth_headers(parent),
        )
        assert response.status_code == 403


class TestInvitingSpecialistBecomesLead:
    async def test_child_created_by_invited_parent_gets_the_inviter(
        self, client, session, make_user, auth_headers
    ):
        """Полный путь: врач зовёт семью → родитель заводит ребёнка → врач его ведёт."""

        doctor = await make_user(UserRole.DOCTOR)
        email = f"family-{uuid.uuid4().hex[:8]}@example.com"

        invited = await client.post(
            INVITATIONS_URL,
            json={"email": email, "role": "parent"},
            headers=auth_headers(doctor),
        )
        token = invited.json()["token"]

        accepted = await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "Мама", "password": "correct horse battery staple"},
        )
        assert accepted.status_code == 201, accepted.text
        parent = await session.scalar(
            select(User).where(User.id == uuid.UUID(accepted.json()["id"]))
        )
        assert parent is not None and parent.invited_by == doctor.id

        created = await client.post(
            "/api/v1/patients",
            json={"full_name": "Ребёнок", "birth_date": "2019-04-12", "sex": "f"},
            headers=auth_headers(parent),
        )
        assert created.status_code == 201, created.text

        patient_id = uuid.UUID(created.json()["id"])
        assert await patients_repo.list_doctor_ids(session, patient_id=patient_id) == [doctor.id]

        # И врач действительно видит нового пациента в своём списке.
        listed = await client.get("/api/v1/patients", headers=auth_headers(doctor))
        assert str(patient_id) in {item["id"] for item in listed.json()["items"]}

    async def test_child_without_inviting_specialist_has_no_lead(
        self, client, session, make_user, auth_headers
    ):
        # Родитель, заведённый не через приглашение специалиста (например, сидером),
        # ребёнка создать может — просто без ведущего врача.
        parent = await make_user(UserRole.PARENT)

        created = await client.post(
            "/api/v1/patients",
            json={"full_name": "Ребёнок", "birth_date": "2019-04-12", "sex": "m"},
            headers=auth_headers(parent),
        )
        assert created.status_code == 201

        patient_id = uuid.UUID(created.json()["id"])
        assert await patients_repo.list_doctor_ids(session, patient_id=patient_id) == []

    async def test_deactivated_inviter_does_not_become_lead(
        self, client, session, make_user, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        email = f"family-{uuid.uuid4().hex[:8]}@example.com"
        token = invitations_repo.generate_token()
        await invitations_repo.create(
            session, email=email, role=UserRole.PARENT, token=token, created_by=doctor.id
        )

        accepted = await client.post(
            "/api/v1/auth/invitations/accept",
            json={"token": token, "full_name": "Мама", "password": "correct horse battery staple"},
        )
        parent = await session.scalar(
            select(User).where(User.id == uuid.UUID(accepted.json()["id"]))
        )
        assert parent is not None

        doctor.is_active = False
        await session.flush()

        created = await client.post(
            "/api/v1/patients",
            json={"full_name": "Ребёнок", "birth_date": "2019-04-12", "sex": "f"},
            headers=auth_headers(parent),
        )
        patient_id = uuid.UUID(created.json()["id"])
        assert await patients_repo.list_doctor_ids(session, patient_id=patient_id) == []


class TestPatientProfileUpdate:
    async def test_parent_updates_growth_and_allergies(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.patch(
            f"/api/v1/patients/{patient.id}",
            json={
                "full_name": "Аня Иванова",
                "height_cm": 121.5,
                "allergies": ["орехи"],
                "notes": None,
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        assert response.json()["height_cm"] == 121.5
        assert response.json()["allergies"] == ["орехи"]

    async def test_doctor_of_the_patient_can_update(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.patch(
            f"/api/v1/patients/{patient.id}",
            json={"full_name": "Аня Иванова", "height_cm": 122.0, "allergies": []},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 200

    async def test_stranger_gets_403(self, client, make_user, make_patient, auth_headers):
        stranger = await make_user(UserRole.DOCTOR)
        patient = await make_patient()

        response = await client.patch(
            f"/api/v1/patients/{patient.id}",
            json={"full_name": "Чужой", "allergies": []},
            headers=auth_headers(stranger),
        )
        assert response.status_code == 403

    @pytest.mark.parametrize("height", [0, -5, 251])
    async def test_impossible_height_rejected(
        self, client, session, make_user, make_patient, auth_headers, height
    ):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.patch(
            f"/api/v1/patients/{patient.id}",
            json={"full_name": "Аня", "height_cm": height, "allergies": []},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_birth_date_and_sex_are_not_editable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        # Возраст и пол уже вошли в сделанные расчёты и отчёты; их правка переписала
        # бы историю задним числом. Лишние поля схема отбрасывает молча, поэтому
        # проверяем именно результат.
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        original_birth_date = patient.birth_date

        response = await client.patch(
            f"/api/v1/patients/{patient.id}",
            json={
                "full_name": "Аня",
                "allergies": [],
                "birth_date": "2001-01-01",
                "sex": "f",
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200
        assert response.json()["birth_date"] == original_birth_date.isoformat()

    async def test_update_is_audited(self, client, session, make_user, make_patient, auth_headers):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        await client.patch(
            f"/api/v1/patients/{patient.id}",
            json={"full_name": "Аня", "height_cm": 123.0, "allergies": ["молоко"]},
            headers=auth_headers(parent),
        )

        entry = await session.scalar(
            select(AuditLog).where(AuditLog.entity == "patients", AuditLog.entity_id == patient.id)
        )
        assert entry is not None
        assert entry.after["allergies"] == ["молоко"]


class TestOwnProfile:
    @pytest.mark.parametrize(
        "role", [UserRole.PARENT, UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.ADMIN]
    )
    async def test_every_role_reads_own_profile(self, client, make_user, auth_headers, role):
        user = await make_user(role)

        response = await client.get("/api/v1/users/me", headers=auth_headers(user))

        assert response.status_code == 200, response.text
        assert response.json()["id"] == str(user.id)
        assert "password_hash" not in response.json()
        assert "totp_secret" not in response.json()

    async def test_requires_authentication(self, client):
        assert (await client.get("/api/v1/users/me")).status_code == 401

    async def test_updates_own_name_and_phone(self, client, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)

        response = await client.patch(
            "/api/v1/users/me",
            json={"full_name": "Дилноза Каримова", "phone": "+998901234567"},
            headers=auth_headers(user),
        )

        assert response.status_code == 200, response.text
        assert response.json()["full_name"] == "Дилноза Каримова"
        assert response.json()["phone"] == "+998901234567"

    @pytest.mark.parametrize(
        "body",
        [
            {"full_name": "Кто-то", "role": "admin"},
            {"full_name": "Кто-то", "is_active": False},
            {"full_name": "Кто-то", "email": "new@example.com"},
        ],
    )
    async def test_cannot_change_role_activity_or_email(
        self, client, make_user, auth_headers, body
    ):
        # Повысить себе права, выключить себя или сменить логин через свой
        # профиль нельзя: схема отвергает лишние поля целиком.
        user = await make_user(UserRole.PARENT)

        response = await client.patch("/api/v1/users/me", json=body, headers=auth_headers(user))
        assert response.status_code == 422

    async def test_empty_name_rejected(self, client, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)
        response = await client.patch(
            "/api/v1/users/me", json={"full_name": "   "}, headers=auth_headers(user)
        )
        assert response.status_code == 422
