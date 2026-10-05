"""Отвеченные клиникой вопросы 4, 15, 17/34, 18 (ADR-0050).

- завершение терапии: врач ставит и снимает, ребёнок уходит из рабочего
  списка, напоминания и просьбы семье прекращаются, карта читается;
- контрольные визиты: график 1/3/6/9/12 месяцев и точка 24 месяцев,
  перечни анализов клиники, ближайший контроль в сводке;
- рост и вес по нормам ВОЗ: z-балл, перцентиль, снижение от исходного;
- типы приступов ILAE 2025: прежние выведены, но читаются.
"""

from __future__ import annotations

import random
import uuid
from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select

from core.clock import local_today
from core.control_schedule import PERIODIC_LABS, add_months
from core.growth import who
from core.models import AuditLog, SeizureLog, SeizureType, WeightLog
from core.models.enums import DiarySource, UserRole
from core.repositories import control_visits as visits_repo
from core.repositories import patients as patients_repo
from core.repositories import reminders as reminders_repo
from core.repositories import telegram as telegram_repo

pytestmark = pytest.mark.asyncio


async def _team(session, make_user, make_patient):
    """Врач, диетолог и родитель одного ребёнка."""

    doctor = await make_user(UserRole.DOCTOR)
    dietitian = await make_user(UserRole.DIETITIAN)
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return doctor, dietitian, parent, patient


async def _audit(session, *, entity: str, action: str) -> list[AuditLog]:
    return list(
        await session.scalars(
            select(AuditLog).where(AuditLog.entity == entity, AuditLog.action == action)
        )
    )


def _end_url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/therapy-end"


# --- завершение терапии (вопрос 18) -----------------------------------------------


class TestTherapyEnd:
    async def test_doctor_ends_therapy_and_patient_leaves_active_list(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, dietitian, _parent, patient = await _team(session, make_user, make_patient)
        other = await make_patient("Второй Ребёнок")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=other.id)
        today = local_today()

        response = await client.put(
            _end_url(patient.id),
            json={"ended_on": today.isoformat(), "reason": "course_completed"},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 200, response.text
        assert response.json()["therapy_ended_on"] == today.isoformat()
        assert response.json()["therapy_end_reason"] == "course_completed"

        active = await client.get(
            "/api/v1/patients", params={"therapy": "active"}, headers=auth_headers(doctor)
        )
        ended = await client.get(
            "/api/v1/patients", params={"therapy": "ended"}, headers=auth_headers(doctor)
        )
        everyone = await client.get("/api/v1/patients", headers=auth_headers(doctor))
        assert [p["id"] for p in active.json()["items"]] == [str(other.id)]
        assert [p["id"] for p in ended.json()["items"]] == [str(patient.id)]
        # Без фильтра — все, как прежде: карта завершившего читается.
        by_id = {p["id"]: p for p in everyone.json()["items"]}
        assert by_id[str(patient.id)]["therapy_ended_on"] == today.isoformat()
        assert by_id[str(other.id)]["therapy_ended_on"] is None

        # Диетолог читает причину в профиле (ADR-0031), но не ставит.
        profile = await client.get(
            f"/api/v1/patients/{patient.id}/medical-profile", headers=auth_headers(dietitian)
        )
        assert profile.json()["therapy_end_reason"] == "course_completed"

        assert len(await _audit(session, entity="medical_profiles", action="therapy_ended")) == 1

    async def test_family_sees_status_in_overview_but_not_reason(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, parent, patient = await _team(session, make_user, make_patient)
        today = local_today()
        await client.put(
            _end_url(patient.id),
            json={"ended_on": today.isoformat(), "reason": "adverse_effects"},
            headers=auth_headers(doctor),
        )

        overview = await client.get(
            f"/api/v1/patients/{patient.id}/overview", headers=auth_headers(parent)
        )
        assert overview.status_code == 200, overview.text
        assert overview.json()["therapy_ended_on"] == today.isoformat()
        assert "adverse_effects" not in overview.text

        card = await client.get(f"/api/v1/patients/{patient.id}", headers=auth_headers(parent))
        assert card.json()["therapy_ended_on"] == today.isoformat()
        assert "adverse_effects" not in card.text

    @pytest.mark.parametrize("role", [UserRole.DIETITIAN, UserRole.PARENT])
    async def test_only_doctor_sets_or_clears(
        self, client, session, make_user, make_patient, auth_headers, role
    ):
        doctor, dietitian, parent, patient = await _team(session, make_user, make_patient)
        actor = dietitian if role is UserRole.DIETITIAN else parent
        body = {"ended_on": local_today().isoformat(), "reason": "ineffective"}

        assert (
            await client.put(_end_url(patient.id), json=body, headers=auth_headers(actor))
        ).status_code == 403
        await client.put(_end_url(patient.id), json=body, headers=auth_headers(doctor))
        assert (
            await client.delete(_end_url(patient.id), headers=auth_headers(actor))
        ).status_code == 403

    async def test_foreign_doctor_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        stranger = await make_user(UserRole.DOCTOR)
        response = await client.put(
            _end_url(patient.id),
            json={"ended_on": local_today().isoformat(), "reason": "ineffective"},
            headers=auth_headers(stranger),
        )
        assert response.status_code == 403

    @pytest.mark.parametrize(
        "body",
        [
            # Будущая дата: завершение — свершившийся факт.
            {"ended_on": "FUTURE", "reason": "ineffective"},
            # «Другое» без пояснения.
            {"ended_on": "TODAY", "reason": "other"},
            {"ended_on": "TODAY", "reason": "other", "note": "   "},
            # Причины нет в списке.
            {"ended_on": "TODAY", "reason": "bored"},
            {"ended_on": "TODAY"},
        ],
    )
    async def test_validation(self, client, session, make_user, make_patient, auth_headers, body):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        today = local_today()
        dates = {"TODAY": today.isoformat(), "FUTURE": (today + timedelta(days=1)).isoformat()}
        payload = {**body, "ended_on": dates[body["ended_on"]]}

        response = await client.put(
            _end_url(patient.id), json=payload, headers=auth_headers(doctor)
        )
        assert response.status_code == 422, response.text

    async def test_end_before_start_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        today = local_today()
        await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={
                "diagnosis": None,
                "epilepsy_type": None,
                "onset_age_months": None,
                "genetics": None,
                "comorbidities": None,
                "therapy_started_on": today.isoformat(),
            },
            headers=auth_headers(doctor),
        )
        response = await client.put(
            _end_url(patient.id),
            json={"ended_on": (today - timedelta(days=10)).isoformat(), "reason": "ineffective"},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422, response.text

    async def test_profile_edit_keeps_the_end_and_resume_clears_it(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        today = local_today()
        await client.put(
            _end_url(patient.id),
            json={"ended_on": today.isoformat(), "reason": "other", "note": "переезд"},
            headers=auth_headers(doctor),
        )
        # Правка диагноза не снимает завершения.
        edited = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={
                "diagnosis": "Синдром Драве",
                "epilepsy_type": None,
                "onset_age_months": None,
                "genetics": None,
                "comorbidities": None,
            },
            headers=auth_headers(doctor),
        )
        assert edited.json()["therapy_ended_on"] == today.isoformat()
        assert edited.json()["therapy_end_note"] == "переезд"

        resumed = await client.delete(_end_url(patient.id), headers=auth_headers(doctor))
        assert resumed.status_code == 204
        profile = await client.get(
            f"/api/v1/patients/{patient.id}/medical-profile", headers=auth_headers(doctor)
        )
        assert profile.json()["therapy_ended_on"] is None
        assert profile.json()["therapy_end_reason"] is None
        assert profile.json()["diagnosis"] == "Синдром Драве"
        assert len(await _audit(session, entity="medical_profiles", action="therapy_resumed")) == 1

        again = await client.delete(_end_url(patient.id), headers=auth_headers(doctor))
        assert again.status_code == 404

    async def test_family_nudge_refused_after_end(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        await client.put(
            _end_url(patient.id),
            json={"ended_on": local_today().isoformat(), "reason": "family_decision"},
            headers=auth_headers(doctor),
        )
        response = await client.post(
            f"/api/v1/patients/{patient.id}/family-nudge", headers=auth_headers(doctor)
        )
        assert response.status_code == 409
        assert response.json()["error"]["details"]["reason"] == "therapy_ended"

    async def test_reminders_stop_after_end(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, parent, patient = await _team(session, make_user, make_patient)
        chat_id = random.randint(10**9, 2 * 10**9)
        await telegram_repo.create_link(
            session, parent_id=parent.id, patient_id=patient.id, chat_id=chat_id, secret="s"
        )

        def chats(rows) -> set[int]:
            return {link.chat_id for _settings, link in rows}

        assert chat_id in chats(await reminders_repo.list_active(session))
        await client.put(
            _end_url(patient.id),
            json={"ended_on": local_today().isoformat(), "reason": "course_completed"},
            headers=auth_headers(doctor),
        )
        assert chat_id not in chats(await reminders_repo.list_active(session))


# --- контрольные визиты (вопросы 17 и 34) -------------------------------------------


async def _start_therapy(client, auth_headers, doctor, patient, start: date) -> None:
    response = await client.put(
        f"/api/v1/patients/{patient.id}/medical-profile",
        json={
            "diagnosis": None,
            "epilepsy_type": None,
            "onset_age_months": None,
            "genetics": None,
            "comorbidities": None,
            "therapy_started_on": start.isoformat(),
        },
        headers=auth_headers(doctor),
    )
    assert response.status_code == 200, response.text


class TestControlVisits:
    async def test_schedule_needs_a_start_date(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/control-visits/schedule", headers=auth_headers(doctor)
        )
        assert response.status_code == 409

    async def test_schedule_follows_the_clinic_answer(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, dietitian, _parent, patient = await _team(session, make_user, make_patient)
        start = date(2026, 1, 31)
        await _start_therapy(client, auth_headers, doctor, patient, start)

        built = await client.post(
            f"/api/v1/patients/{patient.id}/control-visits/schedule", headers=auth_headers(doctor)
        )
        assert built.status_code == 201, built.text
        visits = built.json()
        assert [v["month_offset"] for v in visits] == [1, 3, 6, 9, 12, 24]
        assert visits[0]["planned_on"] == "2026-02-28"  # 31 января + месяц
        assert visits[0]["labs"] == []
        assert visits[1]["labs"] == list(PERIODIC_LABS)
        assert visits[2]["purpose"] == "efficacy_review"
        assert visits[5]["purpose"] == "continuation_review"
        assert len(await _audit(session, entity="control_visits", action="create")) == 6

        # Повтор не задваивает.
        again = await client.post(
            f"/api/v1/patients/{patient.id}/control-visits/schedule", headers=auth_headers(doctor)
        )
        assert again.status_code == 201
        assert again.json() == []

        # Диетолог читает график.
        schedule = await client.get(
            f"/api/v1/patients/{patient.id}/control-schedule", headers=auth_headers(dietitian)
        )
        assert schedule.status_code == 200
        body = schedule.json()
        assert len(body["visits"]) == 6
        assert body["therapy_started_on"] == start.isoformat()
        assert body["weekly_labs"][0] == "ОАК"

    async def test_cancelled_point_is_not_rebuilt_and_family_sees_no_purpose(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, parent, patient = await _team(session, make_user, make_patient)
        # Старт четыре месяца назад: ближайший несостоявшийся — шестимесячный
        # визит с пометкой «оценка эффективности».
        start = add_months(local_today(), -4)
        await _start_therapy(client, auth_headers, doctor, patient, start)
        base = f"/api/v1/patients/{patient.id}"
        built = (
            await client.post(f"{base}/control-visits/schedule", headers=auth_headers(doctor))
        ).json()
        for visit in built[:2]:  # 1 и 3 месяца прошли — отмечены
            await client.patch(
                f"{base}/control-visits/{visit['id']}",
                json={"completed_on": local_today().isoformat()},
                headers=auth_headers(doctor),
            )

        doctor_view = await client.get(f"{base}/overview", headers=auth_headers(doctor))
        family_view = await client.get(f"{base}/overview", headers=auth_headers(parent))
        assert doctor_view.json()["next_control"]["purpose"] == "efficacy_review"
        assert family_view.json()["next_control"]["purpose"] is None
        assert family_view.json()["next_control"]["planned_on"] == built[2]["planned_on"]

        # Отменённую врачом точку повторное построение не возвращает.
        await client.delete(f"{base}/control-visits/{built[3]['id']}", headers=auth_headers(doctor))
        again = await client.post(f"{base}/control-visits/schedule", headers=auth_headers(doctor))
        assert again.json() == []

    async def test_roles(self, client, session, make_user, make_patient, auth_headers):
        doctor, dietitian, parent, patient = await _team(session, make_user, make_patient)
        base = f"/api/v1/patients/{patient.id}"
        body = {"planned_on": local_today().isoformat()}

        assert (
            await client.get(f"{base}/control-schedule", headers=auth_headers(parent))
        ).status_code == 403
        for actor in (dietitian, parent):
            assert (
                await client.post(f"{base}/control-visits", json=body, headers=auth_headers(actor))
            ).status_code == 403
            assert (
                await client.post(f"{base}/control-visits/schedule", headers=auth_headers(actor))
            ).status_code == 403

        created = await client.post(
            f"{base}/control-visits", json=body, headers=auth_headers(doctor)
        )
        visit_id = created.json()["id"]
        for actor in (dietitian, parent):
            assert (
                await client.patch(
                    f"{base}/control-visits/{visit_id}",
                    json={"note": "x"},
                    headers=auth_headers(actor),
                )
            ).status_code == 403
            assert (
                await client.delete(
                    f"{base}/control-visits/{visit_id}", headers=auth_headers(actor)
                )
            ).status_code == 403

    async def test_manual_visit_mark_done_and_next_control(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, parent, patient = await _team(session, make_user, make_patient)
        base = f"/api/v1/patients/{patient.id}"
        today = local_today()

        past = await client.post(
            f"{base}/control-visits",
            json={"planned_on": (today - timedelta(days=2)).isoformat(), "note": "после ЭЭГ"},
            headers=auth_headers(doctor),
        )
        future = await client.post(
            f"{base}/control-visits",
            json={"planned_on": (today + timedelta(days=20)).isoformat()},
            headers=auth_headers(doctor),
        )
        assert past.status_code == 201, past.text
        assert past.json()["overdue"] is True
        assert past.json()["labs"] == []
        assert future.json()["overdue"] is False

        # Пропущенный визит — ближайший, будущий его не прячет.
        overview = await client.get(f"{base}/overview", headers=auth_headers(parent))
        assert overview.json()["next_control"]["planned_on"] == past.json()["planned_on"]
        assert overview.json()["next_control"]["overdue"] is True

        done = await client.patch(
            f"{base}/control-visits/{past.json()['id']}",
            json={"completed_on": today.isoformat()},
            headers=auth_headers(doctor),
        )
        assert done.status_code == 200, done.text
        assert done.json()["overdue"] is False
        overview = await client.get(f"{base}/overview", headers=auth_headers(doctor))
        assert overview.json()["next_control"]["planned_on"] == future.json()["planned_on"]

        deleted = await client.delete(
            f"{base}/control-visits/{future.json()['id']}", headers=auth_headers(doctor)
        )
        assert deleted.status_code == 204
        overview = await client.get(f"{base}/overview", headers=auth_headers(doctor))
        assert overview.json()["next_control"] is None
        assert len(await _audit(session, entity="control_visits", action="delete")) == 1

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"planned_on": None},
            {"completed_on": "FUTURE"},
            {"surprise": 1},
        ],
    )
    async def test_update_validation(
        self, client, session, make_user, make_patient, auth_headers, body
    ):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        base = f"/api/v1/patients/{patient.id}"
        created = await client.post(
            f"{base}/control-visits",
            json={"planned_on": local_today().isoformat()},
            headers=auth_headers(doctor),
        )
        if body.get("completed_on") == "FUTURE":
            body = {"completed_on": (local_today() + timedelta(days=1)).isoformat()}
        response = await client.patch(
            f"{base}/control-visits/{created.json()['id']}", json=body, headers=auth_headers(doctor)
        )
        assert response.status_code == 422, response.text

    async def test_visit_of_another_patient_is_not_found(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        other = await make_patient("Другой")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=other.id)
        created = await client.post(
            f"/api/v1/patients/{other.id}/control-visits",
            json={"planned_on": local_today().isoformat()},
            headers=auth_headers(doctor),
        )
        response = await client.patch(
            f"/api/v1/patients/{patient.id}/control-visits/{created.json()['id']}",
            json={"note": "x"},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 404

    async def test_family_notice_selection_skips_ended_therapy(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, _dietitian, parent, patient = await _team(session, make_user, make_patient)
        chat_id = random.randint(10**9, 2 * 10**9)
        await telegram_repo.create_link(
            session, parent_id=parent.id, patient_id=patient.id, chat_id=chat_id, secret="s"
        )
        day = local_today() + timedelta(days=3)
        await client.post(
            f"/api/v1/patients/{patient.id}/control-visits",
            json={"planned_on": day.isoformat()},
            headers=auth_headers(doctor),
        )

        def chats(rows) -> set[int]:
            return {link.chat_id for _visit, link in rows}

        assert chat_id in chats(await visits_repo.due_for_family_notice(session, planned_on=day))
        await client.put(
            _end_url(patient.id),
            json={"ended_on": local_today().isoformat(), "reason": "course_completed"},
            headers=auth_headers(doctor),
        )
        assert chat_id not in chats(
            await visits_repo.due_for_family_notice(session, planned_on=day)
        )


def test_add_months_is_shared_with_monitoring() -> None:
    """Один календарный месяц у наблюдения и у визитов."""

    from api.services.monitoring import add_months as monitoring_add_months

    assert monitoring_add_months is add_months


# --- рост и вес по ВОЗ (вопрос 15) --------------------------------------------------


def _value_for_z(indicator, sex, age_days: int, z: float) -> float:
    lms = who.lms_at(indicator, sex, age_days)
    assert lms is not None
    return lms.m * (1 + lms.l * lms.s * z) ** (1 / lms.l)


async def _weigh(session, patient, *, on: date, weight: float, height: float | None) -> None:
    session.add(
        WeightLog(
            patient_id=patient.id,
            occurred_at=datetime.combine(on, time(12, 0), tzinfo=UTC),
            source=DiarySource.WEB,
            weight_kg=round(weight, 2),
            height_cm=round(height, 1) if height is not None else None,
        )
    )
    await session.flush()


class TestGrowth:
    async def test_scores_and_significant_drop(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, dietitian, parent, patient = await _team(session, make_user, make_patient)
        start = date(2025, 5, 1)
        await _start_therapy(client, auth_headers, doctor, patient, start)
        # Ребёнку (2018-05-01, мальчик) на старте ровно медиана ВОЗ по весу.
        before = date(2025, 4, 20)
        age_before = (before - patient.birth_date).days
        await _weigh(
            session,
            patient,
            on=before,
            weight=_value_for_z("wfa", "m", age_before, 0.0),
            height=_value_for_z("hfa", "m", age_before, 0.0),
        )
        # Через год вес на 1,2 SD ниже медианы, рост не измерен.
        later = date(2026, 4, 20)
        await _weigh(
            session,
            patient,
            on=later,
            weight=_value_for_z("wfa", "m", (later - patient.birth_date).days, -1.2),
            height=None,
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/growth", headers=auth_headers(doctor)
        )
        assert response.status_code == 200, response.text
        body = response.json()
        first, last = body["points"]
        assert abs(first["wfa"]["z"]) < 0.02
        assert abs(first["wfa"]["percentile"] - 50) < 1
        assert first["hfa"] is not None and first["bmi_for_age"] is not None
        # Рост не измерен — ИМТ и рост-к-возрасту не выдумываются.
        assert last["hfa"] is None and last["bmi"] is None
        wfa = next(i for i in body["indicators"] if i["indicator"] == "wfa")
        assert wfa["baseline_on"] == before.isoformat()
        assert wfa["significant_drop"] is True
        assert wfa["change_sd"] == pytest.approx(-1.2, abs=0.02)
        hfa = next(i for i in body["indicators"] if i["indicator"] == "hfa")
        assert hfa["significant_drop"] is False and hfa["change_sd"] is None
        assert body["significant_drop_sd"] == 1.0
        assert "WHO" in body["source"]

        assert (
            await client.get(
                f"/api/v1/patients/{patient.id}/growth", headers=auth_headers(dietitian)
            )
        ).status_code == 200
        assert (
            await client.get(f"/api/v1/patients/{patient.id}/growth", headers=auth_headers(parent))
        ).status_code == 403

    async def test_no_measurements(self, client, session, make_user, make_patient, auth_headers):
        doctor, _dietitian, _parent, patient = await _team(session, make_user, make_patient)
        response = await client.get(
            f"/api/v1/patients/{patient.id}/growth", headers=auth_headers(doctor)
        )
        assert response.status_code == 200
        assert response.json()["points"] == []
        assert all(i["baseline"] is None for i in response.json()["indicators"])


# --- типы приступов ILAE 2025 (вопрос 4) ----------------------------------------------


class TestSeizureTypesIlae2025:
    async def test_dictionary_lists_ilae_by_default_and_legacy_on_request(
        self, client, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        current = await client.get(
            "/api/v1/dictionaries/seizure-types",
            params={"limit": 200},
            headers=auth_headers(parent),
        )
        codes = {item["code"] for item in current.json()["items"]}
        assert {"ГТКП", "ФППБТК", "ГЭС", "НПБТК"} <= codes
        assert all(not item["retired"] for item in current.json()["items"])
        assert all(item["ilae_ref"] for item in current.json()["items"])

        everything = await client.get(
            "/api/v1/dictionaries/seizure-types",
            params={"limit": 200, "include_retired": True},
            headers=auth_headers(parent),
        )
        retired = [item for item in everything.json()["items"] if item["retired"]]
        assert {item["code"] for item in retired} >= {"TC", "FG"}
        # Действующие идут первыми.
        flags = [item["retired"] for item in everything.json()["items"]]
        assert flags == sorted(flags)

    async def test_new_record_needs_ilae_type_but_legacy_record_stays_editable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _doctor, _dietitian, parent, patient = await _team(session, make_user, make_patient)
        legacy = await session.scalar(select(SeizureType).where(SeizureType.code == "TC"))
        current = await session.scalar(select(SeizureType).where(SeizureType.code == "ГТКП"))
        assert legacy is not None and legacy.retired
        assert current is not None and not current.retired
        url = f"/api/v1/patients/{patient.id}/logs/seizures"
        when = datetime.now(UTC).isoformat()

        refused = await client.post(
            url,
            json={"occurred_at": when, "seizure_type_id": str(legacy.id), "count": 1},
            headers=auth_headers(parent),
        )
        assert refused.status_code == 422

        accepted = await client.post(
            url,
            json={"occurred_at": when, "seizure_type_id": str(current.id), "count": 1},
            headers=auth_headers(parent),
        )
        assert accepted.status_code == 201, accepted.text

        # Запись, сделанная до перехода, правится без смены типа.
        old = SeizureLog(
            patient_id=patient.id,
            occurred_at=datetime.now(UTC),
            source=DiarySource.WEB,
            seizure_type_id=legacy.id,
            count=1,
        )
        session.add(old)
        await session.flush()
        edited = await client.patch(
            f"{url}/{old.id}",
            json={"seizure_type_id": str(legacy.id), "count": 2},
            headers=auth_headers(parent),
        )
        assert edited.status_code == 200, edited.text
        # …а перевести её на другой прежний тип нельзя.
        other_legacy = await session.scalar(select(SeizureType).where(SeizureType.code == "FG"))
        assert other_legacy is not None
        moved = await client.patch(
            f"{url}/{old.id}",
            json={"seizure_type_id": str(other_legacy.id)},
            headers=auth_headers(parent),
        )
        assert moved.status_code == 422
        assert uuid.UUID(accepted.json()["id"])
