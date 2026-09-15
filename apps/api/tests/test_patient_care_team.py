"""Кто ведёт пациента: привязка специалистов и заведение семьи (ADR-0003).

Это тесты безопасности не меньше, чем функциональности: ручка передачи пациента
раздаёт доступ к клиническим данным, и её единственная защита — требование уже
иметь этот доступ.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from core.models import AuditLog
from core.models.enums import UserRole
from core.repositories import access as access_repo
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
    @pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN])
    async def test_family_is_not_invited_by_mail_anymore(
        self, client, make_user, auth_headers, role
    ):
        """Семье выдаётся код в карте ребёнка, а не приглашение (ADR-0040).

        422, а не 403: дело не в правах вызвавшего — роль перестала быть
        допустимым значением для этой ручки. Врачу отвечают тем же, чем
        администратору, и текст называет, куда идти.
        """
        user = await make_user(role)

        response = await client.post(
            INVITATIONS_URL,
            json={"email": "family@example.com", "role": "parent"},
            headers=auth_headers(user),
        )

        assert response.status_code == 422, response.text
        assert "код доступа" in response.json()["error"]["message"]

    async def test_doctor_cannot_invite_staff(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        response = await client.post(
            INVITATIONS_URL,
            json={"email": "colleague@example.com", "role": "doctor"},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 403

    async def test_admin_still_invites_staff(self, client, make_user, auth_headers):
        """Персонал зовут по-прежнему почтой: у сотрудника нет ребёнка, к
        которому можно выдать код."""
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            INVITATIONS_URL,
            json={"email": f"doc-{uuid.uuid4().hex[:8]}@example.com", "role": "doctor"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text

    async def test_parent_cannot_invite(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            INVITATIONS_URL,
            json={"email": "someone@example.com", "role": "doctor"},
            headers=auth_headers(parent),
        )
        assert response.status_code == 403


class TestSpecialistCreatesCard:
    """Карту заводит специалист и сразу её ведёт (ADR-0040).

    Прежде карту заводил родитель, а ведущим становился тот, кто его пригласил
    (`invited_by`). Тесты того механизма жили здесь и ушли вместе с ним: семья
    больше не заводит карт, а доступ выдаётся кодом — его проверки в
    `test_access_codes.py`.
    """

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN])
    async def test_creator_becomes_the_lead(self, client, session, make_user, auth_headers, role):
        specialist = await make_user(role)

        created = await client.post(
            "/api/v1/patients",
            json={"full_name": "Аня Иванова", "birth_date": "2019-04-12", "sex": "f"},
            headers=auth_headers(specialist),
        )

        assert created.status_code == 201, created.text
        patient_id = uuid.UUID(created.json()["id"])
        assert await access_repo.user_has_patient_access(
            session, user_id=specialist.id, role=specialist.role, patient_id=patient_id
        ), "заведённая карта обязана быть доступна тому, кто её завёл"

    async def test_parent_is_told_where_to_go(self, client, make_user, auth_headers):
        """Отказ родителю называет действие, а не просто запрещает."""
        parent = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/patients",
            json={"full_name": "Аня Иванова", "birth_date": "2019-04-12", "sex": "f"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403, response.text
        assert "код доступа" in response.json()["error"]["message"]

    async def test_admin_cannot_create_a_card(self, client, make_user, auth_headers):
        """Администратор к клиническим данным доступа не имеет (правило 5)."""
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/patients",
            json={"full_name": "Аня Иванова", "birth_date": "2019-04-12", "sex": "f"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 403, response.text

    async def test_creation_is_audited(self, client, session, make_user, auth_headers):
        """Появление клинической записи о ребёнке обязано оставить след."""
        doctor = await make_user(UserRole.DOCTOR)

        created = await client.post(
            "/api/v1/patients",
            json={"full_name": "Аня Иванова", "birth_date": "2019-04-12", "sex": "f"},
            headers=auth_headers(doctor),
        )

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "patients",
                AuditLog.entity_id == uuid.UUID(created.json()["id"]),
            )
        )
        assert entry is not None
        assert entry.user_id == doctor.id


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
