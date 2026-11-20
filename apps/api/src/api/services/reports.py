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
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from core.clock import local_date, local_day_bounds
from core.config import get_settings
from core.models import Patient, Prescription
from core.models.enums import KetoneMethod
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
from .medication_frequency import describe_frequency


def period_bounds(period_from: date, period_to: date) -> tuple[datetime, datetime]:
    """Границы суток периода.

    Сутки считает сервер: `to` включает весь последний день, иначе отчёт «по
    31 августа» терял бы всё, что записано 31-го после полуночи.
    """

    # Сутки — местные (часы клиники), а не UTC: иначе записи первых пяти часов
    # первого дня в отчёт не попадали, а последнего — попадали из следующего.
    return local_day_bounds(period_from, period_to)


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


def prescriptions_in_force(
    history: Sequence[Prescription], period_from: date, period_to: date
) -> list[Prescription]:
    """Назначения, по которым ребёнок жил в периоде, в порядке их действия.

    Действующее на день выбирает одно правило (`prescriptions_repo.active_on`,
    ADR-0078), и здесь оно спрашивается на каждый день периода: версия,
    перекрытая поправкой врача или сменённая до начала периода, в отчёт не
    попадает. Последнее в списке — действующее на конец периода: по нему отчёт
    и подписывает «назначение».
    """

    in_force: list[Prescription] = []
    day = period_from
    while day <= period_to:
        active = prescriptions_repo.active_on(history, day)
        if active is not None and all(active.id != item.id for item in in_force):
            in_force.append(active)
        day += timedelta(days=1)
    return in_force


async def build_report(
    session: AsyncSession,
    *,
    patient: Patient,
    period_from: date,
    period_to: date,
    generated_at: datetime,
    with_summaries: bool = False,
) -> PatientReport:
    """Отчёт за период.

    `with_summaries` — врачебные сводки. По умолчанию их нет: сводка написана
    для специалиста, а тот же отчёт видит семья, и раздел о ребёнке, написанный
    не для родителя, не должен появляться у него молча (вопрос 42 медкоманде).
    Ограничение стоит на сборке, а не на экране: экран — это UX, не доступ.
    """

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
    summaries = (
        await reports_repo.list_approved_summaries(
            session, patient_id=patient.id, period_from=period_from, period_to=period_to
        )
        if with_summaries
        else []
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
        day = local_date(row.occurred_at).isoformat()
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
            clinic_card_number=patient.clinic_card_number,
        ),
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
            for item in prescriptions_in_force(history, period_from, period_to)
        ],
        seizures=SeizureSection(
            entries=len(seizures),
            count=sum(row.count for row in seizures),
            by_type=sorted(by_type.values(), key=lambda item: -item.count),
            by_day=dict(sorted(by_day.items())),
        ),
        ketones_blood=_series(
            [
                MeasurementPoint(at=log.occurred_at, value=float(log.value))
                for log in ketones
                if log.method == KetoneMethod.BLOOD
            ]
        ),
        ketones_urine=_series(
            [
                MeasurementPoint(at=log.occurred_at, value=float(log.value))
                for log in ketones
                if log.method == KetoneMethod.URINE
            ]
        ),
        weight=_series(
            [MeasurementPoint(at=log.occurred_at, value=float(log.weight_kg)) for log in weights]
        ),
        medications=[
            MedicationRow(
                drug_name=item.drug_name,
                dose=item.dose,
                # Словами, как в карте: отчёт читают без словарей кабинета.
                frequency=describe_frequency(item.frequency_code, item.frequency),
                started_at=item.started_at,
                stopped_at=item.stopped_at,
            )
            for item in medications
            # Препараты, которые принимались в периоде: отменённый до его начала
            # и назначенный после его конца к этим неделям не относятся.
            if item.started_at <= period_to
            and (item.stopped_at is None or item.stopped_at >= period_from)
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


def _decimal(value: float) -> str:
    """Дробное число для русского Excel: «3,4», а не «3.4»."""

    return f"{value:g}".replace(".", ",")


def _local_moment(moment: datetime) -> str:
    """Момент записи по часам клиники: «2026-11-14 12:02».

    Сутки отчёта местные, и время в файле — тоже: момент в UTC сдвигал ночной
    замер на предыдущий день, а в соседней строке «приступы по дням» тот же
    день стоял местным. Смещение названо один раз, строкой «часовой пояс».
    """

    return f"{moment.astimezone(ZoneInfo(get_settings().tz)):%Y-%m-%d %H:%M}"


def _utc_offset() -> str:
    offset = datetime.now(ZoneInfo(get_settings().tz)).utcoffset() or timedelta(0)
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "−"
    hours, rest = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours}" + (f":{rest:02d}" if rest else "")


def report_to_csv(report: PatientReport) -> str:
    """Отчёт в CSV — для переноса в статистику и в чужие инструменты.

    Один файл с колонкой «раздел»: несколько таблиц разной формы в одном CSV
    иначе не помещаются, а отдавать архив из пяти файлов ради выгрузки за
    неделю — избыточно.

    Файл открывают в русском Excel (ADR-0092): разделитель — «;», дробная
    часть — через запятую, кодировка UTF-8 с BOM. С запятой-разделителем
    Excel видел одну колонку, а «3.4» с точкой он читает как дату «03.апр».
    Даты — ISO, их Excel понимает в любой локали.

    Подписи — по-русски: файл открывает врач, а не программа, и строка
    «seizures_by_type» ему ничего не говорила.
    """

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Раздел", "Показатель", "Значение", "Уточнение"])

    writer.writerow(["Пациент", "ФИО", report.patient.full_name, ""])
    writer.writerow(["Пациент", "Дата рождения", report.patient.birth_date.isoformat(), ""])
    if report.patient.clinic_card_number:
        writer.writerow(["Пациент", "Номер карты клиники", report.patient.clinic_card_number, ""])
    writer.writerow(["Период", "С", report.period.from_date.isoformat(), ""])
    writer.writerow(["Период", "По", report.period.to_date.isoformat(), ""])
    writer.writerow(["Период", "Часовой пояс времени в файле", _utc_offset(), ""])

    for prescription in report.prescriptions:
        writer.writerow(
            [
                "Назначение",
                f"действует с {prescription.effective_from.isoformat()}",
                f"{_decimal(prescription.ratio)} : 1",
                f"{prescription.kcal_per_day} ккал в сутки, "
                f"белок не меньше {_decimal(prescription.protein_g)} г, "
                f"углеводы не больше {_decimal(prescription.carbs_limit_g)} г, "
                f"приёмов в день {prescription.meals_per_day}",
            ]
        )

    writer.writerow(["Приступы", "Всего приступов", report.seizures.count, ""])
    writer.writerow(["Приступы", "Записей в дневнике", report.seizures.entries, ""])
    for by_type in report.seizures.by_type:
        writer.writerow(["Приступы по типам", by_type.name_ru, by_type.count, by_type.code or ""])
    for day, count in report.seizures.by_day.items():
        writer.writerow(["Приступы по дням", day, count, ""])

    # Метод — в последней колонке: кровь и моча — разные шкалы.
    for method, series in (("кровь", report.ketones_blood), ("моча", report.ketones_urine)):
        for point in series.points:
            writer.writerow(
                ["Кетоны, ммоль/л", _local_moment(point.at), _decimal(point.value), method]
            )
    for point in report.weight.points:
        writer.writerow(["Вес, кг", _local_moment(point.at), _decimal(point.value), ""])

    for medication in report.medications:
        stopped = f" по {medication.stopped_at.isoformat()}" if medication.stopped_at else ""
        writer.writerow(
            [
                "Препарат",
                medication.drug_name,
                medication.dose,
                f"{medication.frequency}; с {medication.started_at.isoformat()}{stopped}",
            ]
        )

    for effect in report.side_effects:
        writer.writerow(
            [
                "Нежелательное явление",
                _local_moment(effect.occurred_at),
                effect.symptom,
                effect.description or "",
            ]
        )

    writer.writerow(["Меню", "Дней в плане", report.menu.days_planned, ""])
    writer.writerow(["Меню", "Позиций в плане", report.menu.items_planned, ""])
    writer.writerow(["Меню", "Отмечено съеденным", report.menu.items_eaten, ""])

    for summary in report.summaries:
        writer.writerow(
            [
                "Сводка врача",
                f"{summary.period_start.isoformat()} — {summary.period_end.isoformat()}",
                summary.approved_md,
                "",
            ]
        )

    return buffer.getvalue()
