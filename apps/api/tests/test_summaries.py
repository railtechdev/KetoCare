"""AI-сводка для врача: заказ, черновик, утверждение (раздел 10.5 ТЗ, п. 21)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from core.models import AuditLog, DoctorSummary, KetoneLog, SeizureLog, SeizureType, WeightLog
from core.models.enums import AiJobStatus, DiarySource, KetoneMethod, UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

PERIOD_FROM = date(2026, 8, 1)
PERIOD_TO = date(2026, 8, 31)

DRAFT = (
    "## Приступы\nЗа период записано 6 приступов.\n"
    "## Кетоны\n7 замеров, от 1.9 до 3.2 ммоль/л.\n"
    "## Вес\nданных за период нет\n"
    "## Питание\nданных за период нет\n"
    "## Приверженность\nданных за период нет\n"
    "## Замечания по данным\nданных за период нет\n"
)


def _url(patient_id, *, to: date = PERIOD_TO) -> str:
    return (
        f"/api/v1/patients/{patient_id}/summaries"
        f"?from={PERIOD_FROM.isoformat()}&to={to.isoformat()}"
    )


async def _doctor_with_patient(session, make_user, make_patient):
    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    return doctor, patient


async def _with_draft(session, patient, doctor, *, draft: str = DRAFT, checks=None):
    """Строка, доведённая до состояния «черновик готов», — как её оставляет воркер."""

    summary = DoctorSummary(
        patient_id=patient.id,
        requested_by=doctor.id,
        period_start=PERIOD_FROM,
        period_end=PERIOD_TO,
        status=AiJobStatus.DONE,
        draft_md=draft,
        checks=checks or [],
    )
    session.add(summary)
    await session.flush()
    return summary


class TestRequest:
    async def test_doctor_gets_a_queued_row_and_a_task(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        response = await client.post(_url(patient.id), headers=auth_headers(doctor))

        assert response.status_code == 202, response.text
        body = response.json()
        assert body["status"] == "queued"
        assert body["draft_md"] is None
        assert [name for name, _ in enqueued] == ["doctor_summary"]

    async def test_the_task_carries_ready_series(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Ряды уезжают готовыми, а не собираются воркером заново (ADR-0023).

        Иначе сводка опишет одни числа, а отчёт покажет другие — расхождение в
        клиническом документе, а не косметика.
        """

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        seizure_type = await session.scalar(select(SeizureType).limit(1))
        session.add(
            SeizureLog(
                patient_id=patient.id,
                occurred_at=datetime(2026, 8, 10, 7, 0),
                seizure_type_id=seizure_type.id,
                count=5,
                source=DiarySource.WEB,
            )
        )
        await session.flush()

        await client.post(_url(patient.id), headers=auth_headers(doctor))

        _, args = enqueued[0]
        payload = args[-1]
        assert payload["seizures"]["count"] == 5
        assert payload["period"] == {"from": "2026-08-01", "to": "2026-08-31", "days": 31}

    async def test_the_payload_carries_no_name_or_birth_date(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Правило 6: в промпт не уходят ФИО и дата рождения.

        Псевдонимизация стоит в клиенте модели, но она снимает запрещённые ключи
        и схлопывает словарь пациента целиком — а вместе с ним исчезло бы всё,
        что положили рядом. Поэтому нагрузка собирается без них с самого начала,
        и проверяется это здесь, до всякой чистки.
        """

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        await client.post(_url(patient.id), headers=auth_headers(doctor))

        payload = enqueued[0][1][-1]
        assert "patient" not in payload
        assert set(payload["anthropometry"]) == {"age_months", "sex", "height_cm"}
        assert patient.full_name not in str(payload)
        assert patient.birth_date.isoformat() not in str(payload)

    async def test_a_second_request_reuses_the_pending_one(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Двойное нажатие — это два платных вызова модели по кварталу дневника."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        first = await client.post(_url(patient.id), headers=auth_headers(doctor))
        second = await client.post(_url(patient.id), headers=auth_headers(doctor))

        assert first.json()["id"] == second.json()["id"]
        assert len(enqueued) == 1

    async def test_request_is_written_to_the_audit_log(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        await client.post(_url(patient.id), headers=auth_headers(doctor))

        actions = list(await session.scalars(select(AuditLog.action)))
        assert "ai_summary.request" in actions

    async def test_period_longer_than_the_cap_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        response = await client.post(
            _url(patient.id, to=date(2027, 8, 31)), headers=auth_headers(doctor)
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_parent_may_not_request(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.post(_url(patient.id), headers=auth_headers(parent))

        assert response.status_code == 403

    async def test_dietitian_may_not_request(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 10.5 называет сводку врачебной; расширение круга — вопрос 40."""

        dietitian = await make_user(UserRole.DIETITIAN)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)

        response = await client.post(_url(patient.id), headers=auth_headers(dietitian))

        assert response.status_code == 403

    async def test_another_doctors_patient_is_closed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        someone_elses = await make_patient()

        response = await client.post(_url(someone_elses.id), headers=auth_headers(doctor))

        assert response.status_code == 403


class TestList:
    async def test_only_the_exact_period_is_returned(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сводка за август и сводка за сентябрь — разные документы."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await _with_draft(session, patient, doctor)
        session.add(
            DoctorSummary(
                patient_id=patient.id,
                requested_by=doctor.id,
                period_start=date(2026, 9, 1),
                period_end=date(2026, 9, 30),
                status=AiJobStatus.DONE,
                draft_md=DRAFT,
            )
        )
        await session.flush()

        response = await client.get(_url(patient.id), headers=auth_headers(doctor))

        assert response.status_code == 200
        assert [item["period_start"] for item in response.json()] == ["2026-08-01"]

    async def test_parent_may_not_read(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.get(_url(patient.id), headers=auth_headers(parent))

        assert response.status_code == 403


class TestApprove:
    async def test_approved_text_is_stored_with_author_and_time(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        summary = await _with_draft(session, patient, doctor)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": DRAFT},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["approved_md"] == DRAFT
        assert body["approved_by"] == str(doctor.id)
        assert body["approved_at"] is not None

    async def test_the_draft_never_changes(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Пара «черновик и утверждённое» — доказательство, что человек был в контуре."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        summary = await _with_draft(session, patient, doctor)
        edited = DRAFT.replace("6 приступов", "6 приступов, из них 4 ночных")

        response = await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": edited},
            headers=auth_headers(doctor),
        )

        assert response.json()["draft_md"] == DRAFT
        assert response.json()["approved_md"] == edited

    async def test_a_recommendation_left_in_the_text_blocks_approval(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Утверждение может оказаться механическим нажатием, а `approved_md`
        уходит в отчёт и в PDF — постфильтр проверяет присланный текст заново."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        summary = await _with_draft(session, patient, doctor)
        with_advice = DRAFT.replace(
            "данных за период нет\n## Замечания",
            "Целесообразно обсудить коррекцию дозы.\n## Замечания",
        )

        response = await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": with_advice},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422
        assert response.json()["error"]["details"]["findings"][0]["kind"] == "recommendation"

    async def test_a_draft_that_is_not_ready_cannot_be_approved(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        summary = DoctorSummary(
            patient_id=patient.id,
            requested_by=doctor.id,
            period_start=PERIOD_FROM,
            period_end=PERIOD_TO,
            status=AiJobStatus.QUEUED,
        )
        session.add(summary)
        await session.flush()

        response = await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": DRAFT},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 409

    async def test_approval_is_written_to_the_audit_log_without_the_text(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Журнал читает администратор, которому клинические данные закрыты."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        summary = await _with_draft(session, patient, doctor)

        await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": DRAFT},
            headers=auth_headers(doctor),
        )

        entry = await session.scalar(
            select(AuditLog).where(AuditLog.action == "ai_summary.approve")
        )
        assert entry is not None
        assert "приступ" not in str(entry.after).lower()

    async def test_parent_may_not_approve(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        parent = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        summary = await _with_draft(session, patient, doctor)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": DRAFT},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403


class TestInTheReport:
    """Раздел 10.5: в отчёт попадает только `approved_md`."""

    async def test_a_draft_never_reaches_the_report(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await _with_draft(session, patient, doctor)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/report"
            f"?from={PERIOD_FROM.isoformat()}&to={PERIOD_TO.isoformat()}",
            headers=auth_headers(doctor),
        )

        assert response.json()["summaries"] == []

    async def test_an_approved_summary_reaches_the_doctors_report(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        summary = await _with_draft(session, patient, doctor)
        await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": DRAFT},
            headers=auth_headers(doctor),
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/report"
            f"?from={PERIOD_FROM.isoformat()}&to={PERIOD_TO.isoformat()}",
            headers=auth_headers(doctor),
        )

        assert [item["approved_md"] for item in response.json()["summaries"]] == [DRAFT]

    async def test_the_family_report_carries_no_summaries(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сводка написана специалисту и для специалиста.

        До этой проверки родитель получал врачебный документ в JSON-отчёте и в
        PDF: роль ограничивала только CSV.
        """

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        parent = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        summary = await _with_draft(session, patient, doctor)
        await client.post(
            f"/api/v1/patients/{patient.id}/summaries/{summary.id}/approve",
            json={"approved_md": DRAFT},
            headers=auth_headers(doctor),
        )

        response = await client.get(
            f"/api/v1/patients/{patient.id}/report"
            f"?from={PERIOD_FROM.isoformat()}&to={PERIOD_TO.isoformat()}",
            headers=auth_headers(parent),
        )

        assert response.json()["summaries"] == []

    async def test_only_the_latest_approval_of_a_period_is_printed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Два описания одних данных врач читает как противоречие."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        older = await _with_draft(session, patient, doctor)
        newer = await _with_draft(session, patient, doctor, draft=DRAFT.replace("6 ", "7 "))
        older.approved_md = DRAFT
        older.approved_by = doctor.id
        older.approved_at = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
        newer.approved_md = DRAFT.replace("6 ", "7 ")
        newer.approved_by = doctor.id
        newer.approved_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
        await session.flush()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/report"
            f"?from={PERIOD_FROM.isoformat()}&to={PERIOD_TO.isoformat()}",
            headers=auth_headers(doctor),
        )

        summaries = response.json()["summaries"]
        assert len(summaries) == 1
        assert "7 приступов" in summaries[0]["approved_md"]


class TestSeriesForThePrompt:
    """Ряды раздела 10.5, которых в отчёте не было."""

    async def test_ketones_are_split_by_method(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """Кровь и моча в один ряд не сводятся: сопоставимость шкал — вопрос 14."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        for value, method in ((3.0, KetoneMethod.BLOOD), (1.5, KetoneMethod.URINE)):
            session.add(
                KetoneLog(
                    patient_id=patient.id,
                    occurred_at=datetime(2026, 8, 5, 8, 0),
                    value=value,
                    method=method,
                    source=DiarySource.WEB,
                )
            )
        await session.flush()

        await client.post(_url(patient.id), headers=auth_headers(doctor))

        ketones = enqueued[0][1][-1]["ketones"]
        assert ketones["blood"]["mean"] == 3.0
        assert ketones["urine"]["mean"] == 1.5

    async def test_days_with_entries_are_counted(
        self, client, session, make_user, make_patient, auth_headers, enqueued
    ):
        """«% дней с записями» — это не дни со спланированным меню."""

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        for day in (2, 3):
            session.add(
                WeightLog(
                    patient_id=patient.id,
                    occurred_at=datetime(2026, 8, day, 8, 0),
                    weight_kg=14.2,
                    source=DiarySource.WEB,
                )
            )
        await session.flush()

        await client.post(_url(patient.id), headers=auth_headers(doctor))

        coverage = enqueued[0][1][-1]["coverage"]
        assert coverage["days_with_entries"] == 2
        assert coverage["longest_gap_days"] == 28
