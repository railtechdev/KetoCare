"""Разграничение доступа — правило 5 CLAUDE.md, раздел 5.1 ТЗ.

Это тесты безопасности: они проверяют, что ручки с данными пациента
недоступны без связи с ним, и что админ не видит клинические данные.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

VALID_PRESCRIPTION = {
    "ratio": 4.0,
    "kcal_per_day": 1200,
    "protein_g": 25.0,
    "carbs_limit_g": 10.0,
    "meals_per_day": 3,
    "effective_from": "2026-01-01",
}


class TestUnauthenticated:
    async def test_patient_endpoint_requires_auth(self, client):
        response = await client.get(f"/api/v1/patients/{uuid.uuid4()}")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_calc_requires_auth(self, client):
        response = await client.post("/api/v1/calc/verify", json={"ingredients": [], "items": []})
        assert response.status_code == 401

    async def test_garbage_token_rejected(self, client):
        response = await client.get(
            f"/api/v1/patients/{uuid.uuid4()}", headers={"Authorization": "Bearer not-a-jwt"}
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"


class TestPatientScoping:
    async def test_parent_cannot_read_other_childs_profile(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        other_child = await make_patient("Чужой Ребёнок")

        response = await client.get(
            f"/api/v1/patients/{other_child.id}", headers=auth_headers(parent)
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"

    async def test_parent_can_read_own_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        child = await make_patient("Свой Ребёнок")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=child.id)

        response = await client.get(f"/api/v1/patients/{child.id}", headers=auth_headers(parent))
        assert response.status_code == 200
        assert response.json()["full_name"] == "Свой Ребёнок"

    async def test_doctor_cannot_read_unattached_patient(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()

        response = await client.get(f"/api/v1/patients/{patient.id}", headers=auth_headers(doctor))
        assert response.status_code == 403

    async def test_admin_has_no_clinical_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Админ не имеет доступа к клиническим данным (раздел 5.1 ТЗ),
        даже если строка связи существует."""
        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=admin.id, patient_id=patient.id)

        response = await client.get(f"/api/v1/patients/{patient.id}", headers=auth_headers(admin))
        assert response.status_code == 403

    async def test_patients_list_is_scoped_to_own_links(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        own = await make_patient("Свой")
        await make_patient("Чужой")
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=own.id)

        response = await client.get("/api/v1/patients", headers=auth_headers(parent))
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["full_name"] == "Свой"


class TestPrescriptionAuthorization:
    async def test_parent_cannot_create_prescription(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Назначение создаёт только врач/диетолог (раздел 5.3 ТЗ)."""
        parent = await make_user(UserRole.PARENT)
        child = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=child.id)

        response = await client.post(
            f"/api/v1/patients/{child.id}/prescriptions",
            json=VALID_PRESCRIPTION,
            headers=auth_headers(parent),
        )
        assert response.status_code == 403

    async def test_doctor_cannot_prescribe_for_unattached_patient(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()

        response = await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json=VALID_PRESCRIPTION,
            headers=auth_headers(doctor),
        )
        assert response.status_code == 403

    async def test_doctor_creates_prescription_for_attached_patient(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json=VALID_PRESCRIPTION,
            headers=auth_headers(doctor),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["ratio"] == 4.0
        assert body["author_id"] == str(doctor.id)

    async def test_new_prescription_creates_version_not_overwrite(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Append-only: вторая запись не заменяет первую (правило 4 CLAUDE.md)."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        headers = auth_headers(doctor)
        url = f"/api/v1/patients/{patient.id}/prescriptions"

        first = await client.post(url, json=VALID_PRESCRIPTION, headers=headers)
        second = await client.post(url, json={**VALID_PRESCRIPTION, "ratio": 3.0}, headers=headers)
        assert first.status_code == 201 and second.status_code == 201
        assert first.json()["id"] != second.json()["id"]

        history = await client.get(url, headers=headers)
        assert history.json()["total"] == 2

        active = await client.get(f"{url}/active", headers=headers)
        assert active.json()["ratio"] == 3.0, "активное назначение — последнее созданное"


class TestPrescriptionValidation:
    @pytest.mark.parametrize(
        "field,value",
        [
            ("ratio", 0.5),  # ниже 1.0
            ("ratio", 6.0),  # выше 5.0
            ("kcal_per_day", 100),  # ниже 500
            ("kcal_per_day", 5000),  # выше 3000
            ("meals_per_day", 0),
            ("protein_g", -1),
        ],
    )
    async def test_out_of_range_values_rejected(
        self, client, session, make_user, make_patient, auth_headers, field, value
    ):
        """Границы из раздела 8.3 ТЗ: ratio 1.0-5.0, kcal 500-3000."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json={**VALID_PRESCRIPTION, field: value},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_validation_error_shape_matches_spec(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json={**VALID_PRESCRIPTION, "ratio": 99},
            headers=auth_headers(doctor),
        )
        error = response.json()["error"]
        assert set(error) == {"code", "message", "details"}
        assert isinstance(error["message"], str) and error["message"]


class TestProductAuthorization:
    async def test_parent_cannot_create_product(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/products",
            json={
                "name_ru": "Тест",
                "category_id": str(uuid.uuid4()),
                "kcal_100g": 100,
                "fat_100g": 1,
                "protein_100g": 1,
                "carbs_100g": 1,
                "fiber_100g": 0,
                "source": "USDA",
                "source_version": "SR28",
                "verified_at": str(date(2026, 1, 1)),
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 403

    async def test_any_authenticated_user_can_search_products(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        response = await client.get("/api/v1/products", headers=auth_headers(parent))
        assert response.status_code == 200
        assert "items" in response.json() and "total" in response.json()


class TestInactiveUser:
    async def test_deactivated_user_token_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Деактивация действует немедленно, не дожидаясь истечения токена."""
        parent = await make_user(UserRole.PARENT, is_active=False)
        response = await client.get("/api/v1/patients", headers=auth_headers(parent))
        assert response.status_code == 401


class TestPrescriptionArithmeticFeasibility:
    """Назначение, невыполнимое арифметически, отклоняется.

    Это не медицинское правило (правило 1 CLAUDE.md), а тождество: при соотношении R
    и калорийности K на белки с углеводами приходится ровно K/(9R+4) грамм. Цель по
    белку выше этой величины недостижима ни при каком наборе продуктов, а назначения
    append-only — ошибочную строку нельзя исправить, только перекрыть новой.
    """

    async def test_impossible_protein_target_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        # R=4, K=1000 -> максимум белков+углеводов = 25 г; просим 60 г белка
        response = await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json={**VALID_PRESCRIPTION, "ratio": 4.0, "kcal_per_day": 1000, "protein_g": 60.0},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "validation_error"
        assert "25.0" in error["message"], error["message"]

    async def test_feasible_prescription_still_accepted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Проверка не должна мешать нормальным назначениям."""
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/prescriptions",
            json={**VALID_PRESCRIPTION, "ratio": 4.0, "kcal_per_day": 1200, "protein_g": 25.0},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 201, response.text
