"""Клинические ручки: медицинский профиль, препараты, врачебные заметки.

Клиент берётся общий, из conftest, — тот, что собирает приложение как в бою
(`create_app()` со всеми роутерами). Раньше файл монтировал `clinical.router`
себе сам, и это было неправдой дважды: роутер давно подключён в `api.main`, то
есть тесты ходили по ДУБЛИРУЮЩИМ маршрутам, а зависимости, добавленные при
подключении в `main.py`, были для них невидимы. Проверено: закомментируй строку
подключения в `main.py` — вся матрица прав этого файла оставалась зелёной.

Общий клиент заодно даёт каждому тесту свой адрес: ключ ограничения частоты —
это адрес клиента, и на своём его не было."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

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
    "frequency_code": "twice_daily",
    "frequency": "утром и на ночь",
    "started_at": TODAY.isoformat(),
}


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

    async def test_therapy_start_is_stored_and_returned(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ответ клиники 09.09.2026 (вопрос 17): «отдельное поле».

        От этой даты отсчитываются контрольные визиты, и по ней же решается,
        считать ли ответ семьи о частоте приступов исходным уровнем. Вывод из
        первого назначения остаётся запасным — он лжёт у ребёнка, которого
        перевели из другой клиники уже на диете.
        """

        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        url = f"/api/v1/patients/{patient.id}/medical-profile"

        saved = await client.put(
            url,
            json={**PROFILE, "therapy_started_on": "2026-04-15"},
            headers=auth_headers(doctor),
        )

        assert saved.status_code == 200, saved.text
        assert saved.json()["therapy_started_on"] == "2026-04-15"
        assert (await client.get(url, headers=auth_headers(doctor))).json()[
            "therapy_started_on"
        ] == "2026-04-15"

    async def test_therapy_start_may_be_in_the_future(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """«Диету начинаем с понедельника» — обычное врачебное решение.

        Дата последнего приступа будущей быть не может (вопрос 48), и соблазн
        применить то же правило здесь велик — но это решение О БУДУЩЕМ, и
        запретить вносить его заранее значило бы заставить врача возвращаться в
        карту в день старта.
        """

        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        ahead = TODAY.replace(year=TODAY.year + 5)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={**PROFILE, "therapy_started_on": ahead.isoformat()},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["therapy_started_on"] == ahead.isoformat()

    async def test_therapy_start_before_birth_is_a_typo(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """До рождения ребёнка диеты не было — это тождество, а не порог.

        Перепутанный год тихо сдвинул бы и расписание визитов, и правило про
        исходную частоту приступов, а по результату отличить его от верной даты
        нельзя.
        """

        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        before_birth = patient.birth_date - timedelta(days=1)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={**PROFILE, "therapy_started_on": before_birth.isoformat()},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "therapy_started_on"

    async def test_dietitian_reads_the_profile_but_cannot_change_it(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ответ клиники 09.09.2026 (вопросы 7 и 31).

        «Диетолог может видеть диагноз, календарь приступов, назначения врача по
        АЭП, но не вносить изменения.» Раздел 5.3 ТЗ помечал профиль врачебной
        ручкой целиком, и до ответа он был закрыт — ошибиться в эту сторону было
        безопаснее. Диагноз определяет, какую диету вообще собирают: подбирать
        рацион вслепую и был прежний порядок.

        Чтение и запись проверяются одним тестом намеренно: разрешение читать
        осмысленно ровно в паре с запретом писать, и разведи их по двум тестам —
        удаление одного осталось бы незамеченным.
        """
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        dietitian = await make_user(UserRole.DIETITIAN)
        await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)
        url = f"/api/v1/patients/{patient.id}/medical-profile"
        await client.put(url, json=PROFILE, headers=auth_headers(doctor))

        read = await client.get(url, headers=auth_headers(dietitian))
        assert read.status_code == 200, read.text
        assert read.json()["diagnosis"] == PROFILE["diagnosis"]

        assert (
            await client.put(url, json=PROFILE, headers=auth_headers(dietitian))
        ).status_code == 403

    async def test_dietitian_without_link_cannot_read(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Роль открывает вид данных, а не всех детей клиники.

        Обе ступени обязательны (правило 5 CLAUDE.md): роль отвечает «какие
        данные», `require_patient_access` — «чей ребёнок». Расширение роли до
        диетолога не должно превращать её во вторую отмычку.
        """
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        stranger = await make_user(UserRole.DIETITIAN)
        url = f"/api/v1/patients/{patient.id}/medical-profile"
        await client.put(url, json=PROFILE, headers=auth_headers(doctor))

        assert (await client.get(url, headers=auth_headers(stranger))).status_code == 403

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

    async def test_dietitian_sees_the_scheme_but_does_not_prescribe(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ответ клиники 09.09.2026 (вопрос 31).

        «Диетолог не имеет права назначать лекарства — только относительно диеты
        (но имеет право видеть назначенные препараты).» Чтение здесь и раньше
        было открыто всем, у кого есть доступ к пациенту, — ради родителя,
        который даёт препарат ребёнку. Тест закрепляет это как обещание клинике,
        а не как побочный эффект: сузь ручку до врача — и диетолог, собирающий
        рацион, перестанет видеть, что ребёнок принимает.
        """
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        dietitian = await make_user(UserRole.DIETITIAN)
        await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)
        url = f"/api/v1/patients/{patient.id}/medications"
        created = await client.post(url, json=MEDICATION, headers=auth_headers(doctor))
        medication_id = created.json()["id"]

        listed = await client.get(url, headers=auth_headers(dietitian))
        assert listed.status_code == 200, listed.text
        assert [item["drug_name"] for item in listed.json()["items"]] == [MEDICATION["drug_name"]]

        assert (
            await client.post(url, json=MEDICATION, headers=auth_headers(dietitian))
        ).status_code == 403
        assert (
            await client.put(
                f"{url}/{medication_id}", json=MEDICATION, headers=auth_headers(dietitian)
            )
        ).status_code == 403
        assert (
            await client.delete(f"{url}/{medication_id}", headers=auth_headers(dietitian))
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
            # Кратность — из списка (ADR-0033): без кода и с чужим кодом нельзя.
            {key: value for key, value in MEDICATION.items() if key != "frequency_code"},
            {**MEDICATION, "frequency_code": "BID"},
            # «Другая схема» без слов не говорит, как давать препарат.
            {**MEDICATION, "frequency_code": "other", "frequency": None},
            {**MEDICATION, "frequency_code": "other", "frequency": "   "},
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

    async def test_code_alone_describes_frequency(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/medications",
            # Пустое уточнение — это «уточнения нет», а не строка из пробелов.
            json={**MEDICATION, "frequency_code": "once_daily", "frequency": "  "},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 201, response.text
        assert response.json()["frequency_code"] == "once_daily"
        assert response.json()["frequency"] is None

    async def test_other_scheme_with_words_is_accepted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/medications",
            json={**MEDICATION, "frequency_code": "other", "frequency": "через два дня на третий"},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 201, response.text
        assert response.json()["frequency"] == "через два дня на третий"

    async def test_record_from_before_the_list_keeps_its_words(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Запись, заведённая до списка, читается как была: код не выдумывается."""
        doctor, patient = await _attached(session, make_user, make_patient, UserRole.DOCTOR)
        session.add(
            Medication(
                patient_id=patient.id,
                drug_name="Леветирацетам",
                dose="250 мг",
                frequency="утром и на ночь",
                started_at=TODAY,
                author_id=doctor.id,
            )
        )
        await session.flush()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/medications", headers=auth_headers(doctor)
        )

        [item] = response.json()["items"]
        assert item["frequency_code"] is None
        assert item["frequency"] == "утром и на ночь"

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
        """Заметки остаются врачебными и после расширения доступа к профилю.

        В ответе клиники (вопросы 7 и 31) перечислено, что диетолог видит:
        диагноз, календарь приступов, назначения по АЭП. Врачебных заметок в
        этом списке нет — это личное свидетельство врача о приёме, а не
        клинический факт о ребёнке, и добавлять их «заодно» было бы решением за
        медицинскую команду.
        """
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
