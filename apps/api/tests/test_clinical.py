"""Клинические ручки врача: медицинский профиль, препараты, врачебные заметки.

Роутер ещё не подключён в `api.main`, поэтому здесь свой `client`: он собирает
приложение и добавляет проверяемый роутер сам. Остальные фикстуры — из conftest.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps.auth import get_session
from api.main import create_app
from api.routers import clinical
from core.models import AuditLog, ClinicalNote, MedicalProfile, Medication
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

TODAY = date(2026, 6, 1)

PROFILE = {
    "diagnosis": "Синдром Драве",
    "epilepsy_type": "фокальная",
    "onset_age_months": 7,
    "genetics": {"gene": "SCN1A", "variant": "c.1234A>G", "interpretation": "патогенный"},
    "comorbidities": "задержка развития",
}

MEDICATION = {
    "drug_name": "Вальпроевая кислота",
    "dose": "300 мг",
    "frequency": "2 раза в сутки",
    "started_at": TODAY.isoformat(),
}


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()
    app.include_router(clinical.router, prefix="/api/v1")

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


async def _attached(session, make_user, make_patient, role: UserRole):
    """Пользователь клинической роли, прикреплённый к пациенту."""

    user = await make_user(role)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=user.id, patient_id=patient.id)
    return user, patient


async def _parent_of(session, make_user, patient):
    parent = await make_user(UserRole.PARENT)
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent


class TestMedicalProfile:
    async def test_put_creates_profile_and_get_returns_it(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/medical-profile"

        created = await client.put(url, json=PROFILE, headers=auth_headers(doctor))
        assert created.status_code == 200, created.text
        assert created.json()["genetics"]["gene"] == "SCN1A"

        fetched = await client.get(url, headers=auth_headers(doctor))
        assert fetched.status_code == 200
        assert fetched.json()["diagnosis"] == PROFILE["diagnosis"]
        assert fetched.json()["onset_age_months"] == 7

    async def test_put_is_upsert_not_second_row(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """На patient_id уникальный индекс: вторая запись профиля не создаётся,
        иначе непонятно, какой из диагнозов действующий."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/medical-profile"

        first = await client.put(url, json=PROFILE, headers=auth_headers(doctor))
        second = await client.put(
            url,
            json={**PROFILE, "diagnosis": "Синдром Леннокса-Гасто", "genetics": None},
            headers=auth_headers(doctor),
        )
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]
        assert second.json()["diagnosis"] == "Синдром Леннокса-Гасто"
        assert second.json()["genetics"] is None, "PUT заменяет профиль целиком"

        rows = await session.scalar(
            select(func.count())
            .select_from(MedicalProfile)
            .where(MedicalProfile.patient_id == patient.id)
        )
        assert rows == 1

    async def test_get_missing_profile_returns_404(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        response = await client.get(
            f"/api/v1/patients/{patient.id}/medical-profile", headers=auth_headers(doctor)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"

    async def test_dietitian_has_no_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 5.3 ТЗ помечает медицинский профиль врачебной ручкой.

        Возможно, диетологу чтение нужно — он подбирает рацион, а диагноз на это
        влияет. Но расширять доступ к клиническим данным ребёнка за медицинскую
        команду нельзя: вопрос в docs/medical/OPEN_QUESTIONS.md, до ответа закрыто.
        """
        dietitian, patient = await _attached(session, make_user, make_patient, UserRole.DIETITIAN)
        url = f"/api/v1/patients/{patient.id}/medical-profile"

        assert (await client.get(url, headers=auth_headers(dietitian))).status_code == 403
        assert (
            await client.put(url, json=PROFILE, headers=auth_headers(dietitian))
        ).status_code == 403

    async def test_parent_has_no_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Родитель связан с пациентом, но диагноз и генетика — врачебные данные."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        parent = await _parent_of(session, make_user, patient)
        url = f"/api/v1/patients/{patient.id}/medical-profile"
        await client.put(url, json=PROFILE, headers=auth_headers(doctor))

        assert (await client.get(url, headers=auth_headers(parent))).status_code == 403
        assert (
            await client.put(url, json=PROFILE, headers=auth_headers(parent))
        ).status_code == 403

    async def test_doctor_without_link_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        outsider = await make_user(UserRole.DOCTOR)
        patient = await make_patient("Чужой")

        response = await client.get(
            f"/api/v1/patients/{patient.id}/medical-profile", headers=auth_headers(outsider)
        )
        assert response.status_code == 403

    @pytest.mark.parametrize(
        "payload",
        [
            {"onset_age_months": -1},
            {"onset_age_months": 36000},
            {"diagnosis": "x", "unknown_field": "y"},
            {"genetics": {"gene": "SCN1A", "unknown": "y"}},
        ],
    )
    async def test_invalid_payload_rejected(
        self, client, session, make_user, make_patient, auth_headers, payload
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json=payload,
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_overwrite_keeps_previous_diagnosis_in_audit(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Профиль перезаписывается на месте — прежний диагноз восстанавливается
        только из audit_log."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/medical-profile"

        await client.put(url, json=PROFILE, headers=auth_headers(doctor))
        await client.put(
            url, json={**PROFILE, "diagnosis": "Уточнён"}, headers=auth_headers(doctor)
        )

        entries = list(
            await session.scalars(
                select(AuditLog)
                .where(AuditLog.entity == "medical_profiles")
                .order_by(AuditLog.action)
            )
        )
        actions = {entry.action for entry in entries}
        assert actions == {"create", "update"}
        update_entry = next(e for e in entries if e.action == "update")
        assert update_entry.before["diagnosis"] == PROFILE["diagnosis"]
        assert update_entry.after["diagnosis"] == "Уточнён"


class TestMedications:
    async def test_doctor_creates_medication(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/medications",
            json=MEDICATION,
            headers=auth_headers(doctor),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["author_id"] == str(doctor.id)
        assert body["stopped_at"] is None

    async def test_parent_reads_active_medications(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 7.3 ТЗ: бот показывает родителю активные препараты на сегодня —
        значит чтение схемы родителю доступно."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        parent = await _parent_of(session, make_user, patient)
        url = f"/api/v1/patients/{patient.id}/medications"

        await client.post(
            url,
            json={
                **MEDICATION,
                "drug_name": "Отменённый",
                "started_at": (TODAY - timedelta(days=30)).isoformat(),
                "stopped_at": (TODAY - timedelta(days=10)).isoformat(),
            },
            headers=auth_headers(doctor),
        )
        await client.post(url, json=MEDICATION, headers=auth_headers(doctor))

        everything = await client.get(url, headers=auth_headers(parent))
        assert everything.status_code == 200
        assert everything.json()["total"] == 2

        active = await client.get(
            url, params={"active_on": TODAY.isoformat()}, headers=auth_headers(parent)
        )
        assert [m["drug_name"] for m in active.json()["items"]] == [MEDICATION["drug_name"]]

    async def test_parent_cannot_change_therapy(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        parent = await _parent_of(session, make_user, patient)
        url = f"/api/v1/patients/{patient.id}/medications"
        created = await client.post(url, json=MEDICATION, headers=auth_headers(doctor))
        medication_id = created.json()["id"]

        assert (
            await client.post(url, json=MEDICATION, headers=auth_headers(parent))
        ).status_code == 403
        assert (
            await client.put(
                f"{url}/{medication_id}", json=MEDICATION, headers=auth_headers(parent)
            )
        ).status_code == 403
        assert (
            await client.delete(f"{url}/{medication_id}", headers=auth_headers(parent))
        ).status_code == 403

    async def test_stopped_medication_stays_in_history(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Окончание приёма — не удаление: запись объясняет уже сделанные отметки
        о приёме и остаётся в истории."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/medications"
        created = await client.post(url, json=MEDICATION, headers=auth_headers(doctor))
        medication_id = created.json()["id"]

        stopped = await client.put(
            f"{url}/{medication_id}",
            json={**MEDICATION, "stopped_at": TODAY.isoformat()},
            headers=auth_headers(doctor),
        )
        assert stopped.status_code == 200
        assert stopped.json()["stopped_at"] == TODAY.isoformat()

        listing = await client.get(url, headers=auth_headers(doctor))
        assert listing.json()["total"] == 1

        active_after = await client.get(
            url,
            params={"active_on": (TODAY + timedelta(days=1)).isoformat()},
            headers=auth_headers(doctor),
        )
        assert active_after.json()["total"] == 0, "после stopped_at препарат не активен"

    async def test_update_keeps_prescribing_author(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        colleague = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=colleague.id, patient_id=patient.id)
        url = f"/api/v1/patients/{patient.id}/medications"

        created = await client.post(url, json=MEDICATION, headers=auth_headers(doctor))
        updated = await client.put(
            f"{url}/{created.json()['id']}",
            json={**MEDICATION, "dose": "500 мг"},
            headers=auth_headers(colleague),
        )
        assert updated.json()["author_id"] == str(doctor.id), "автор — назначивший врач"

        # Отбор по entity_id обязателен: без него запрос без сортировки и лимита
        # берёт произвольную строку журнала и цепляет запись постороннего прогона,
        # оставшуюся в базе разработчика. Тест падал не по своей причине.
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "medications",
                AuditLog.action == "update",
                AuditLog.entity_id == uuid.UUID(created.json()["id"]),
            )
        )
        assert entry is not None and entry.user_id == colleague.id
        assert entry.before["dose"] == MEDICATION["dose"]

    async def test_delete_is_soft(self, client, session, make_user, make_patient, auth_headers):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/medications"
        created = await client.post(url, json=MEDICATION, headers=auth_headers(doctor))
        medication_id = created.json()["id"]

        deleted = await client.delete(f"{url}/{medication_id}", headers=auth_headers(doctor))
        assert deleted.status_code == 204

        listing = await client.get(url, headers=auth_headers(doctor))
        assert listing.json()["total"] == 0

        row = await session.scalar(select(Medication).where(Medication.id == medication_id))
        assert row is not None, "клиническая запись физически не удаляется"
        assert row.deleted_at is not None

    async def test_medication_of_another_patient_not_reachable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        other_patient = await make_patient("Другой")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=other_patient.id)

        created = await client.post(
            f"/api/v1/patients/{other_patient.id}/medications",
            json=MEDICATION,
            headers=auth_headers(doctor),
        )
        medication_id = created.json()["id"]

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medications/{medication_id}",
            json={**MEDICATION, "dose": "999 мг"},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 404, "чужая запись не должна быть достижима"

        deleted = await client.delete(
            f"/api/v1/patients/{patient.id}/medications/{medication_id}",
            headers=auth_headers(doctor),
        )
        assert deleted.status_code == 404

    @pytest.mark.parametrize(
        "payload",
        [
            {**MEDICATION, "stopped_at": (TODAY - timedelta(days=1)).isoformat()},
            {**MEDICATION, "drug_name": ""},
            {**MEDICATION, "dose": ""},
            {**MEDICATION, "started_at": "не дата"},
        ],
    )
    async def test_invalid_payload_rejected(
        self, client, session, make_user, make_patient, auth_headers, payload
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/medications",
            json=payload,
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_medication_returns_404(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        response = await client.delete(
            f"/api/v1/patients/{patient.id}/medications/{uuid.uuid4()}",
            headers=auth_headers(doctor),
        )
        assert response.status_code == 404


class TestClinicalNotes:
    async def test_doctor_adds_and_reads_note(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/clinical-notes"

        created = await client.post(
            url, json={"text": "Кетоз стабилен, дозу не меняем."}, headers=auth_headers(doctor)
        )
        assert created.status_code == 201, created.text
        assert created.json()["author_id"] == str(doctor.id), "автор берётся из токена"

        listing = await client.get(url, headers=auth_headers(doctor))
        assert listing.json()["total"] == 1
        assert listing.json()["items"][0]["text"] == "Кетоз стабилен, дозу не меняем."

    async def test_parent_has_no_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        parent = await _parent_of(session, make_user, patient)
        url = f"/api/v1/patients/{patient.id}/clinical-notes"

        assert (await client.get(url, headers=auth_headers(parent))).status_code == 403
        assert (
            await client.post(url, json={"text": "от родителя"}, headers=auth_headers(parent))
        ).status_code == 403

    async def test_dietitian_has_no_access(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 5.3 ТЗ относит заметки к врачу; диетолог ведёт медпрофиль, но
        не врачебный дневник."""
        dietitian, patient = await _attached(session, make_user, make_patient, UserRole.DIETITIAN)
        response = await client.get(
            f"/api/v1/patients/{patient.id}/clinical-notes", headers=auth_headers(dietitian)
        )
        assert response.status_code == 403

    async def test_notes_cannot_be_edited_or_deleted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Заметка — свидетельство того, что врач видел в тот момент; ручек
        изменения и удаления нет, поэтому метод не поддерживается."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/clinical-notes"
        await client.post(url, json={"text": "Первичный осмотр"}, headers=auth_headers(doctor))

        assert (await client.delete(url, headers=auth_headers(doctor))).status_code == 405
        assert (
            await client.put(url, json={"text": "правка"}, headers=auth_headers(doctor))
        ).status_code == 405

        row = await session.scalar(
            select(ClinicalNote).where(ClinicalNote.patient_id == patient.id)
        )
        assert row is not None and row.deleted_at is None

    @pytest.mark.parametrize("payload", [{"text": ""}, {}, {"text": "x", "author_id": "подмена"}])
    async def test_invalid_payload_rejected(
        self, client, session, make_user, make_patient, auth_headers, payload
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/clinical-notes",
            json=payload,
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
