"""Сборка отчёта по пациенту за период (раздел 5.3 ТЗ, `/reports`).

Отчёт ничего не вычисляет заново: показатели берутся теми же репозиториями, что
питают экраны. Расхождение между тем, что врач видел на экране, и тем, что
напечаталось в PDF, — клинический риск, а не косметика.

Единственное, что считается здесь, — сводные числа рядов (минимум, максимум,
среднее) и разбивка приступов по типам и дням. Это арифметика над уже
выбранными записями, а не вторая версия правды.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Patient
from core.repositories import medications as medications_repo
from core.repositories import prescriptions as prescriptions_repo
from core.repositories import reports as reports_repo

from ..schemas_reports import (
    DoctorSummaryRow,
    MeasurementPoint,
    MeasurementSeries,
    MedicationRow,
    MenuAdherence,
    PatientReport,
    ReportPatient,
    ReportPeriod,
    ReportPrescription,
    SeizureByType,
    SeizureSection,
    SideEffectRow,
)


def period_bounds(period_from: date, period_to: date) -> tuple[datetime, datetime]:
    """Границы суток периода.

    Сутки считает сервер: `to` включает весь последний день, иначе отчёт «по
    31 августа» терял бы всё, что записано 31-го после полуночи.
    """

    start = datetime.combine(period_from, datetime.min.time())
    end = datetime.combine(period_to, datetime.min.time()) + timedelta(days=1)
    return start, end


def _series(points: list[MeasurementPoint]) -> MeasurementSeries:
    values = [point.value for point in points]
    if not values:
        return MeasurementSeries(points=[], min=None, max=None, mean=None)
    return MeasurementSeries(
        points=points,
        min=min(values),
        max=max(values),
        # Округление до сотых: кетоны измеряют с одним знаком, вес с двумя, и
        # среднее с пятнадцатью знаками читается как ложная точность.
        mean=round(sum(values) / len(values), 2),
    )


async def build_report(
    session: AsyncSession,
    *,
    patient: Patient,
    period_from: date,
    period_to: date,
    generated_at: datetime,
) -> PatientReport:
    start, end = period_bounds(period_from, period_to)

    seizures = await reports_repo.list_seizures(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    ketones = await reports_repo.list_ketones(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    weights = await reports_repo.list_weights(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    side_effects = await reports_repo.list_side_effects(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    adherence = await reports_repo.menu_adherence(
        session, patient_id=patient.id, period_from=period_from, period_to=period_to
    )
    summaries = await reports_repo.list_approved_summaries(
        session, patient_id=patient.id, period_from=period_from, period_to=period_to
    )

    history, _ = await prescriptions_repo.list_history(
        session, patient_id=patient.id, limit=100, offset=0
    )
    medications, _ = await medications_repo.list_for_patient(
        session, patient_id=patient.id, limit=100, offset=0
    )

    by_type: dict[uuid.UUID, SeizureByType] = {}
    by_day: dict[str, int] = {}
    for row in seizures:
        entry = by_type.get(row.seizure_type_id)
        if entry is None:
            by_type[row.seizure_type_id] = SeizureByType(
                seizure_type_id=row.seizure_type_id,
                name_ru=row.name_ru,
                code=row.code,
                entries=1,
                count=row.count,
            )
        else:
            by_type[row.seizure_type_id] = entry.model_copy(
                update={"entries": entry.entries + 1, "count": entry.count + row.count}
            )
        day = row.occurred_at.date().isoformat()
        by_day[day] = by_day.get(day, 0) + row.count

    return PatientReport(
        generated_at=generated_at,
        period=ReportPeriod(from_date=period_from, to_date=period_to),
        patient=ReportPatient(
            id=patient.id,
            full_name=patient.full_name,
            birth_date=patient.birth_date,
            sex=patient.sex.value,
            height_cm=float(patient.height_cm) if patient.height_cm is not None else None,
        ),
        # Назначения, действовавшие в периоде: те, что начались не позже его
        # конца. Более раннее назначение тоже действовало — оно и есть то, по
        # которому семья жила в начале периода.
        prescriptions=[
            ReportPrescription(
                ratio=float(item.ratio),
                kcal_per_day=item.kcal_per_day,
                protein_g=float(item.protein_g),
                carbs_limit_g=float(item.carbs_limit_g),
                meals_per_day=item.meals_per_day,
                effective_from=item.effective_from,
                created_at=item.created_at,
            )
            for item in history
            if item.effective_from <= period_to
        ],
        seizures=SeizureSection(
            entries=len(seizures),
            count=sum(row.count for row in seizures),
            by_type=sorted(by_type.values(), key=lambda item: -item.count),
            by_day=dict(sorted(by_day.items())),
        ),
        ketones=_series(
            [MeasurementPoint(at=log.occurred_at, value=float(log.value)) for log in ketones]
        ),
        weight=_series(
            [MeasurementPoint(at=log.occurred_at, value=float(log.weight_kg)) for log in weights]
        ),
        medications=[
            MedicationRow(
                drug_name=item.drug_name,
                dose=item.dose,
                frequency=item.frequency,
                started_at=item.started_at,
                stopped_at=item.stopped_at,
            )
            for item in medications
        ],
        side_effects=[
            SideEffectRow(
                occurred_at=log.occurred_at,
                symptom=log.symptom,
                description=log.description,
            )
            for log in side_effects
        ],
        menu=MenuAdherence(
            days_planned=adherence.days_planned,
            items_planned=adherence.items_planned,
            items_eaten=adherence.items_eaten,
        ),
        summaries=[
            DoctorSummaryRow(
                period_start=item.period_start,
                period_end=item.period_end,
                # Фильтр по `approved_md is not null` стоит в репозитории;
                # здесь остаётся только развернуть Optional для типов.
                approved_md=item.approved_md or "",
            )
            for item in summaries
        ],
    )


def report_to_csv(report: PatientReport) -> str:
    """Отчёт в CSV — для переноса в статистику и в чужие инструменты.

    Один файл с колонкой «раздел»: несколько таблиц разной формы в одном CSV
    иначе не помещаются, а отдавать архив из пяти файлов ради выгрузки за
    неделю — избыточно. Разделитель — запятая, кодировка UTF-8 с BOM: без BOM
    Excel открывает кириллицу как мусор.
    """

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["section", "key", "value", "extra"])

    writer.writerow(["patient", "full_name", report.patient.full_name, ""])
    writer.writerow(["patient", "birth_date", report.patient.birth_date.isoformat(), ""])
    writer.writerow(["period", "from", report.period.from_date.isoformat(), ""])
    writer.writerow(["period", "to", report.period.to_date.isoformat(), ""])

    for prescription in report.prescriptions:
        writer.writerow(
            [
                "prescription",
                prescription.effective_from.isoformat(),
                f"{prescription.ratio}:1",
                f"{prescription.kcal_per_day} ккал, белок {prescription.protein_g} г, "
                f"углеводы до {prescription.carbs_limit_g} г, "
                f"приёмов {prescription.meals_per_day}",
            ]
        )

    writer.writerow(["seizures", "total_count", report.seizures.count, ""])
    writer.writerow(["seizures", "total_entries", report.seizures.entries, ""])
    for by_type in report.seizures.by_type:
        writer.writerow(["seizures_by_type", by_type.name_ru, by_type.count, by_type.code or ""])
    for day, count in report.seizures.by_day.items():
        writer.writerow(["seizures_by_day", day, count, ""])

    for point in report.ketones.points:
        writer.writerow(["ketones", point.at.isoformat(), point.value, ""])
    for point in report.weight.points:
        writer.writerow(["weight", point.at.isoformat(), point.value, ""])

    for medication in report.medications:
        stopped = f" по {medication.stopped_at.isoformat()}" if medication.stopped_at else ""
        writer.writerow(
            [
                "medication",
                medication.drug_name,
                medication.dose,
                f"{medication.frequency}; с {medication.started_at.isoformat()}{stopped}",
            ]
        )

    for effect in report.side_effects:
        writer.writerow(
            [
                "side_effect",
                effect.occurred_at.isoformat(),
                effect.symptom,
                effect.description or "",
            ]
        )

    writer.writerow(["menu", "days_planned", report.menu.days_planned, ""])
    writer.writerow(["menu", "items_planned", report.menu.items_planned, ""])
    writer.writerow(["menu", "items_eaten", report.menu.items_eaten, ""])

    for summary in report.summaries:
        writer.writerow(
            [
                "summary",
                f"{summary.period_start.isoformat()}..{summary.period_end.isoformat()}",
                summary.approved_md,
                "",
            ]
        )

    return buffer.getvalue()
