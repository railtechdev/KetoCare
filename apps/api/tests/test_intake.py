"""Анкета регистрации пациента и её справочники (ADR-0007)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import func, select

from core.models import PatientIntake
from core.models.enums import IntakeScale, UserRole
from core.repositories import intake as intake_repo
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


async def _parent_with_child(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _option_id(session, scale: IntakeScale, index: int = 0):
    options = await intake_repo.list_options(session, scale=scale)
    return str(options[index].id)


class TestIntakeDictionaries:
    async def test_options_can_be_narrowed_to_one_scale(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_DURATION.value},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        scales = {item["scale"] for item in response.json()["items"]}
        assert scales == {IntakeScale.SEIZURE_DURATION.value}

    async def test_options_carry_stable_codes(self, client, make_user, auth_headers):
        # Статистика собирается по коду: медицинская команда переформулирует
        # вариант (вопросы 19-21), и без кода прежние ответы стали бы несравнимы.
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options", headers=auth_headers(parent)
        )

        assert response.status_code == 200
        assert all(item["code"] for item in response.json()["items"])

    async def test_drugs_expose_synonyms(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/dictionaries/aed-drugs", headers=auth_headers(parent))

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert items and all(item["synonyms"] for item in items)

    async def test_seizure_types_expose_code(self, client, make_user, auth_headers):
        # Месячная сетка дневника подписывает столбцы кодом: «Тонико-клонический»
        # в клетку не помещается, «TC» — да.
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/seizure-types", headers=auth_headers(parent)
        )

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert any(item["code"] for item in items)
        assert all("code" in item for item in items)


class TestPatientIntake:
    async def test_parent_fills_and_reads_own_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/intake"
        body = {
            "last_seizure_on": date(2026, 5, 20).isoformat(),
            "seizure_frequency_id": await _option_id(session, IntakeScale.SEIZURE_FREQUENCY),
            "developmental_delay": True,
            "meals_regular": False,
        }

        saved = await client.put(url, json=body, headers=auth_headers(parent))
        assert saved.status_code == 200, saved.text

        fetched = await client.get(url, headers=auth_headers(parent))
        assert fetched.status_code == 200
        assert fetched.json()["developmental_delay"] is True
        assert fetched.json()["last_seizure_on"] == "2026-05-20"

    async def test_put_is_upsert_not_second_row(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/intake"

        first = await client.put(url, json={"meals_regular": True}, headers=auth_headers(parent))
        second = await client.put(url, json={"meals_regular": False}, headers=auth_headers(parent))

        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]

        rows = await session.scalar(
            select(func.count())
            .select_from(PatientIntake)
            .where(PatientIntake.patient_id == patient.id)
        )
        assert rows == 1

    async def test_option_from_another_scale_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Внешний ключ проверяет существование варианта, но не его смысл.

        Без этой проверки «Ежедневно» записывается в длительность приступа, и
        анкета, собираемая ради анализа, перестаёт что-либо значить.
        """
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        frequency_id = await _option_id(session, IntakeScale.SEIZURE_FREQUENCY)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_duration_id": frequency_id},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"
        assert response.json()["error"]["details"]["field"] == "seizure_duration_id"

    async def test_unknown_drug_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"current_aed_ids": ["3f0f9d1e-0000-4000-8000-000000000000"]},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"

    async def test_stranger_gets_403(self, client, session, make_user, make_patient, auth_headers):
        _, patient = await _parent_with_child(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/intake", headers=auth_headers(stranger)
        )

        assert response.status_code == 403

    async def test_missing_intake_returns_404(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/intake", headers=auth_headers(parent)
        )

        assert response.status_code == 404


class TestDoctorPartOfIntake:
    async def test_parent_cannot_write_aed_switch_count(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Врачебное поле анкеты недоступно семье не экраном, а сервером.

        Заказчик просил объективности: «родители не всегда правильно помнят
        диагноз, тип приступа». Поле живёт в медицинском профиле, а профиль
        закрыт от родителя целиком.
        """
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={"aed_switch_count_id": await _option_id(session, IntakeScale.AED_SWITCH_COUNT)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403

    async def test_doctor_writes_aed_switch_count(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        option_id = await _option_id(session, IntakeScale.AED_SWITCH_COUNT)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={"diagnosis": "Синдром Драве", "aed_switch_count_id": option_id},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["aed_switch_count_id"] == option_id

    async def test_doctor_option_from_another_scale_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={"aed_switch_count_id": await _option_id(session, IntakeScale.ONSET_AGE)},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "aed_switch_count_id"


class TestRetiredDictionaryValues:
    """Выведенный из употребления вариант не предлагается, но остаётся читаемым.

    Удалить его нельзя: на него ссылаются заполненные анкеты, и ответ семьи не
    должен исчезать вместе со сменой формулировки (правило 4 CLAUDE.md).
    """

    async def test_retired_options_are_hidden_by_default(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)

        default = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_DURATION.value},
            headers=auth_headers(parent),
        )
        with_retired = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={
                "scale": IntakeScale.SEIZURE_DURATION.value,
                "include_retired": "true",
            },
            headers=auth_headers(parent),
        )

        assert default.status_code == 200, default.text
        assert all(not item["retired"] for item in default.json()["items"])
        assert with_retired.json()["total"] > default.json()["total"]

    async def test_duration_scale_has_no_gap_between_5_and_10_minutes(
        self, client, session, make_user, auth_headers
    ):
        """Разрыв 5-10 минут в шкале заказчика закрыт; границы совмещены с
        операциональным определением эпилептического статуса ILAE (Trinka 2015)."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_DURATION.value},
            headers=auth_headers(parent),
        )

        codes = [item["code"] for item in response.json()["items"]]
        assert "dur_5_10min" in codes
        assert "dur_under_5min" not in codes, "перекрывающийся вариант выведен"

    async def test_frequency_scale_can_express_seizure_freedom(
        self, client, session, make_user, auth_headers
    ):
        """Цель кетотерапии — прекращение приступов. Шкале заказчика её выразить
        было нечем: варианты шли от «ежедневно» до «раз в 2-3 месяца»."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_FREQUENCY.value},
            headers=auth_headers(parent),
        )

        codes = [item["code"] for item in response.json()["items"]]
        assert "freq_none" in codes
        assert "freq_rarer" in codes

    async def test_aed_switch_count_scale_does_not_overlap(
        self, client, session, make_user, auth_headers
    ):
        """«2 препарата», «более 2х», «более 5» пересекались: сменивший шесть
        подходил под два варианта сразу, а сменивший одного — ни под один."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.AED_SWITCH_COUNT.value},
            headers=auth_headers(parent),
        )

        codes = {item["code"] for item in response.json()["items"]}
        assert {"aed_0", "aed_1", "aed_2", "aed_3_5", "aed_6_plus"} <= codes
        assert "aed_over_2" not in codes

    async def test_drugs_are_one_per_substance(self, client, session, make_user, auth_headers):
        """Строка заказчика «Карбамазепин, Окскарбазепин, Трилептал, Тегретол»
        объединяла два разных действующих вещества."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/dictionaries/aed-drugs", headers=auth_headers(parent))

        names = {item["name_ru"] for item in response.json()["items"]}
        assert "Карбамазепин" in names
        assert "Окскарбазепин" in names
        assert "Карбамазепин, Окскарбазепин, Трилептал, Тегретол" not in names

    async def test_retired_option_can_still_be_saved(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Анкета, заполненная старым вариантом, обязана сохраняться дальше:
        иначе семья не сможет поправить в ней ни одного другого поля."""
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        retired = [
            option
            for option in await intake_repo.list_options(
                session, scale=IntakeScale.SEIZURE_DURATION, include_retired=True
            )
            if option.retired
        ]

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_duration_id": str(retired[0].id)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
