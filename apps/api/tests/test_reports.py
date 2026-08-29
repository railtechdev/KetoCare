"""Отчёт по пациенту за период (раздел 5.3 ТЗ, раздел 15 п. 14)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select

from core.models import AuditLog, KetoneLog, SeizureLog, SeizureType
from core.models.enums import DiarySource, KetoneMethod, UserRole
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo

pytestmark = pytest.mark.asyncio

PERIOD_FROM = date(2026, 8, 1)
PERIOD_TO = date(2026, 8, 31)


async def _doctor_with_patient(session, make_user, make_patient):
    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    return doctor, patient


async def _parent_with_child(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _seizure(session, patient, *, at: datetime, count: int):
    seizure_type = await session.scalar(select(SeizureType).limit(1))
    log = SeizureLog(
        patient_id=patient.id,
        occurred_at=at,
        seizure_type_id=seizure_type.id,
        count=count,
        source=DiarySource.WEB,
    )
    session.add(log)
    await session.flush()
    return log


async def _ketone(session, patient, *, at: datetime, value: float):
    log = KetoneLog(
        patient_id=patient.id,
        occurred_at=at,
        value=value,
        method=KetoneMethod.BLOOD,
        source=DiarySource.WEB,
    )
    session.add(log)
    await session.flush()
    return log


def _url(patient_id, fmt: str = "json", to: date = PERIOD_TO) -> str:
    return (
        f"/api/v1/patients/{patient_id}/report"
        f"?from={PERIOD_FROM.isoformat()}&to={to.isoformat()}&format={fmt}"
    )


class TestReportContent:
    async def test_counts_seizures_not_entries(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Одна запись описывает серию: подмена приступов записями занизила бы
        клиническую картину — та же оговорка, что в сводке главной."""
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await _seizure(session, patient, at=datetime(2026, 8, 10, 7, 0), count=5)
        await _seizure(session, patient, at=datetime(2026, 8, 10, 20, 0), count=1)

        response = await client.get(_url(patient.id), headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        seizures = response.json()["seizures"]
        assert seizures["entries"] == 2
        assert seizures["count"] == 6
        assert seizures["by_day"]["2026-08-10"] == 6

    async def test_last_day_of_period_is_included(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отчёт «по 31 августа» обязан включать всё, что записано 31-го:
        иначе последний день периода молча теряется."""
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await _seizure(session, patient, at=datetime(2026, 8, 31, 23, 30), count=1)

        response = await client.get(_url(patient.id), headers=auth_headers(doctor))

        assert response.json()["seizures"]["count"] == 1

    async def test_records_outside_period_are_excluded(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await _seizure(session, patient, at=datetime(2026, 7, 31, 12, 0), count=3)
        await _seizure(session, patient, at=datetime(2026, 9, 1, 12, 0), count=3)

        response = await client.get(_url(patient.id), headers=auth_headers(doctor))

        assert response.json()["seizures"]["count"] == 0

    async def test_measurement_series_carries_summary_numbers(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        for day, value in ((2, 1.0), (3, 4.0), (4, 2.5)):
            await _ketone(session, patient, at=datetime(2026, 8, day, 8, 0), value=value)

        ketones = (await client.get(_url(patient.id), headers=auth_headers(doctor))).json()[
            "ketones"
        ]

        assert len(ketones["points"]) == 3
        assert ketones["min"] == 1.0
        assert ketones["max"] == 4.0
        assert ketones["mean"] == 2.5

    async def test_empty_period_is_a_valid_report(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Пустой период — не ошибка: «за месяц приступов не было» и есть
        результат, ради которого назначают терапию."""
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        response = await client.get(_url(patient.id), headers=auth_headers(doctor))

        assert response.status_code == 200
        body = response.json()
        assert body["seizures"]["count"] == 0
        assert body["ketones"]["mean"] is None

    async def test_prescription_history_is_listed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await prescriptions_repo.create(
            session,
            patient_id=patient.id,
            ratio=4.0,
            kcal_per_day=1200,
            protein_g=25.0,
            carbs_limit_g=10.0,
            meals_per_day=3,
            restrictions=None,
            author_id=doctor.id,
            effective_from=date(2026, 8, 5),
        )

        body = (await client.get(_url(patient.id), headers=auth_headers(doctor))).json()

        assert [item["ratio"] for item in body["prescriptions"]] == [4.0]


class TestReportAccess:
    async def test_stranger_gets_403(self, client, session, make_user, make_patient, auth_headers):
        _, patient = await _doctor_with_patient(session, make_user, make_patient)
        stranger = await make_user(UserRole.DOCTOR)

        response = await client.get(_url(patient.id), headers=auth_headers(stranger))

        assert response.status_code == 403

    async def test_parent_reads_json_report_of_own_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.get(_url(patient.id), headers=auth_headers(parent))

        assert response.status_code == 200

    async def test_parent_cannot_export_csv(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Раздел 8.3 ТЗ: выгрузка — только врачу. Файл уезжает из продукта, и
        дальше его судьбу никто не контролирует."""
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.get(_url(patient.id, "csv"), headers=auth_headers(parent))

        assert response.status_code == 403


class TestCsvExport:
    async def test_csv_is_downloadable_and_readable_by_excel(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await _seizure(session, patient, at=datetime(2026, 8, 10, 7, 0), count=2)

        response = await client.get(_url(patient.id, "csv"), headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        assert "attachment" in response.headers["content-disposition"]
        # BOM: без него Excel открывает кириллицу как мусор.
        assert response.text.startswith("﻿")
        assert "seizures_by_day,2026-08-10,2" in response.text

    async def test_export_is_written_to_audit_log(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Правило 7 CLAUDE.md: выгрузка данных — событие для журнала. Когда
        клинические данные покидают систему, должен остаться след."""
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        await client.get(_url(patient.id, "csv"), headers=auth_headers(doctor))

        rows = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.entity == "reports", AuditLog.action == "export")
        )
        assert rows == 1

    async def test_json_report_is_not_audited_as_export(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Чтение экрана — не выгрузка: журнал, где каждое открытие отчёта
        считается вывозом данных, перестают читать."""
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        await client.get(_url(patient.id), headers=auth_headers(doctor))

        rows = await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.entity == "reports")
        )
        assert rows == 0


class TestPeriodValidation:
    async def test_reversed_period_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/report?from=2026-08-31&to=2026-08-01",
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_too_long_period_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отчёт собирается синхронно: «за всё время» одним запросом положит и
        ручку, и экран."""
        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)

        response = await client.get(
            _url(patient.id, to=PERIOD_FROM + timedelta(days=400)),
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422


class TestPdfJob:
    async def test_pdf_request_creates_job_and_enqueues_it(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ):
        """PDF собирает воркер: weasyprint долгий, и держать на нём веб-процесс
        нельзя (раздел 10.1 ТЗ)."""
        from api.services import queue as queue_service

        enqueued: list[tuple] = []

        async def fake_enqueue(task: str, *args):
            enqueued.append((task, args))

        monkeypatch.setattr(queue_service, "enqueue", fake_enqueue)

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        response = await client.get(_url(patient.id, "pdf"), headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "queued"
        assert enqueued and enqueued[0][0] == "render_report"
        # Данные отчёта уезжают в задачу готовыми: воркер не собирает их заново.
        assert enqueued[0][1][1]["patient"]["id"] == str(patient.id)

    async def test_pdf_request_is_audited(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ):
        from api.services import queue as queue_service

        monkeypatch.setattr(queue_service, "enqueue", lambda *a, **k: _noop())

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        await client.get(_url(patient.id, "pdf"), headers=auth_headers(doctor))

        rows = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.entity == "reports", AuditLog.action == "export")
        )
        assert rows == 1

    async def test_stranger_cannot_poll_someone_elses_job(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ):
        """Путь задачи не содержит пациента, и `require_patient_access` здесь не
        сработает — доступ проверяется по пациенту из самой задачи."""
        from api.services import queue as queue_service
        from core.repositories import report_jobs as jobs_repo

        monkeypatch.setattr(queue_service, "enqueue", lambda *a, **k: _noop())

        _, patient = await _doctor_with_patient(session, make_user, make_patient)
        job = await jobs_repo.create(
            session,
            patient_id=patient.id,
            requested_by=(await make_user(UserRole.DOCTOR)).id,
            period_start=PERIOD_FROM,
            period_end=PERIOD_TO,
        )
        stranger = await make_user(UserRole.DOCTOR)

        response = await client.get(
            f"/api/v1/reports/jobs/{job.id}", headers=auth_headers(stranger)
        )

        assert response.status_code == 403

    async def test_download_before_render_is_a_conflict(
        self, client, session, make_user, make_patient, auth_headers
    ):
        from core.repositories import report_jobs as jobs_repo

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        job = await jobs_repo.create(
            session,
            patient_id=patient.id,
            requested_by=doctor.id,
            period_start=PERIOD_FROM,
            period_end=PERIOD_TO,
        )

        response = await client.get(
            f"/api/v1/reports/jobs/{job.id}/file", headers=auth_headers(doctor)
        )

        assert response.status_code == 409

    async def test_expired_link_is_not_served(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ссылка с истечением (раздел 7.5 ТЗ): просроченную не продлеваем
        молча — файла к этому моменту может уже не быть."""
        from core.repositories import report_jobs as jobs_repo

        doctor, patient = await _doctor_with_patient(session, make_user, make_patient)
        job = await jobs_repo.create(
            session,
            patient_id=patient.id,
            requested_by=doctor.id,
            period_start=PERIOD_FROM,
            period_end=PERIOD_TO,
        )
        await jobs_repo.mark_done(
            session,
            job=job,
            file_name=f"{job.id}.pdf",
            expires_at=datetime(2020, 1, 1, tzinfo=UTC),
        )

        response = await client.get(
            f"/api/v1/reports/jobs/{job.id}/file", headers=auth_headers(doctor)
        )

        assert response.status_code == 404


async def _noop() -> None:
    return None
