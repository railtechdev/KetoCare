"""Вход AI-сводки: ряды за период, посчитанные до обращения к модели (раздел 10.5 ТЗ).

Три решения этого модуля стоит держать в голове целиком — по отдельности каждое
выглядит перестраховкой.

**Считаем мы, а не модель.** Промпт запрещает выдумывать числа, но сумма по
пятистам отметкам о приёме препаратов — не выдумка, а арифметика, и ошибётся в
ней модель незаметно: врач читает сводку как факт и перепроверить её нечем.
Поэтому наружу уходят готовые агрегаты, а не сырые ряды.

**Собирает API, а не воркер.** Раздел 5.4 ТЗ говорит обратное, но у задачи нет
ни токена, ни `require_patient_access`, а числа сводки обязаны совпадать с
числами отчёта — обе причины те же, что в ADR-0008. Расхождение записано в
[ADR-0023](../../../../../docs/adr/0023-doctor-summary.md).

**Свободного текста нет ни одного поля.** Ни описаний приступов, ни жалоб, ни
прошлых сводок: `pseudonymize` снимает запрещённые ключи, но внутрь строкового
значения не смотрит, а «вечером Аня жаловалась на тошноту» — это имя ребёнка в
промпте (ADR-0019).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Patient
from core.models.enums import KetoneMethod
from core.repositories import prescriptions as prescriptions_repo
from core.repositories import reports as reports_repo

from .reports import period_bounds

#: Сколько самых длинных пропусков перечислять. Больше — это уже ряд, а не замечание.
MAX_GAPS = 3


def _months_between(born: date, today: date) -> int:
    months = (today.year - born.year) * 12 + today.month - born.month
    if today.day < born.day:
        months -= 1
    return max(months, 0)


def _week_start(day: date) -> date:
    """Понедельник недели, которой принадлежит день."""

    return day - timedelta(days=day.weekday())


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def _series_stats(values: list[float]) -> dict[str, Any]:
    return {
        "measurements": len(values),
        "min": _round(min(values)) if values else None,
        "max": _round(max(values)) if values else None,
        "mean": _mean(values),
    }


def _longest_run(days: set[date], period_from: date, period_to: date) -> int:
    """Самая длинная череда дней периода, которых нет во множестве."""

    longest = 0
    current = 0
    day = period_from
    while day <= period_to:
        if day in days:
            current = 0
        else:
            current += 1
            longest = max(longest, current)
        day += timedelta(days=1)
    return longest


def _gaps(days: set[date], period_from: date, period_to: date) -> list[dict[str, Any]]:
    """Промежутки без записей, самые длинные сверху."""

    found: list[dict[str, Any]] = []
    start: date | None = None
    day = period_from
    while day <= period_to:
        if day in days:
            if start is not None:
                found.append({"from": start, "to": day - timedelta(days=1)})
                start = None
        elif start is None:
            start = day
        day += timedelta(days=1)
    if start is not None:
        found.append({"from": start, "to": period_to})

    for gap in found:
        gap["days"] = (gap["to"] - gap["from"]).days + 1
    found.sort(key=lambda gap: -int(gap["days"]))
    return [
        {"from": gap["from"].isoformat(), "to": gap["to"].isoformat(), "days": gap["days"]}
        for gap in found[:MAX_GAPS]
    ]


async def build_summary_input(
    session: AsyncSession,
    *,
    patient: Patient,
    period_from: date,
    period_to: date,
) -> dict[str, Any]:
    """Ряды раздела 10.5 ТЗ в том виде, в каком они уходят в промпт."""

    start, end = period_bounds(period_from, period_to)
    days_in_period = (period_to - period_from).days + 1

    seizures = await reports_repo.list_seizures(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    ketones = await reports_repo.list_ketones(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    weights = await reports_repo.list_weights(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    adherence = await reports_repo.menu_adherence(
        session, patient_id=patient.id, period_from=period_from, period_to=period_to
    )
    medications = await reports_repo.medication_adherence(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    entry_days = await reports_repo.days_with_entries(
        session, patient_id=patient.id, period_from=start, period_to=end
    )
    menu_days = await reports_repo.list_menu_days(
        session, patient_id=patient.id, period_from=period_from, period_to=period_to
    )
    history, _ = await prescriptions_repo.list_history(
        session, patient_id=patient.id, limit=100, offset=0
    )

    return {
        "period": {
            "from": period_from.isoformat(),
            "to": period_to.isoformat(),
            "days": days_in_period,
        },
        # Ключ намеренно не `patient`. Псевдонимизация заменяет словарь с этим
        # именем одной строкой-меткой — и вместе с личностью исчезает всё, что
        # лежало рядом: рост пропал бы молча, а модель написала бы «данных о
        # росте нет», что читается как отсутствие измерений, а не как дефект
        # сборки. Личности здесь нет вовсе: ни идентификатора, ни даты рождения,
        # ни имени — сводка пишется про одного ребёнка, и различать их не нужно.
        "anthropometry": {
            "age_months": _months_between(patient.birth_date, period_to),
            "sex": patient.sex.value,
            "height_cm": float(patient.height_cm) if patient.height_cm is not None else None,
        },
        "prescriptions": _prescriptions(history, period_to),
        "seizures": _seizures(seizures, period_from, period_to),
        "ketones": _ketones(ketones),
        "weight": _weight(weights),
        "menu": _menu(adherence, menu_days, history, days_in_period),
        "coverage": _coverage(entry_days, period_from, period_to, days_in_period),
        "medications": [
            {
                "drug_name": row.drug_name,
                "dose": row.dose,
                "entries": row.entries,
                "taken": row.taken,
                "not_taken": row.entries - row.taken,
                # Доля считается здесь, а не моделью: сводка обязана брать числа
                # готовыми (`worker.ai.grounding`). Знаменатель — отметки, а не
                # «положено приёмов»: числа приёмов в сутки в схеме нет
                # (вопрос 37).
                "taken_pct": round(row.taken / row.entries * 100, 1) if row.entries else None,
            }
            for row in medications
        ],
    }


def _prescriptions(history: list[Any], period_to: date) -> list[dict[str, Any]]:
    """Назначения, действовавшие в периоде, — с датами, от старых к новым."""

    return [
        {
            "effective_from": item.effective_from.isoformat(),
            "ratio": float(item.ratio),
            "kcal_per_day": item.kcal_per_day,
            "protein_g": float(item.protein_g),
            "carbs_limit_g": float(item.carbs_limit_g),
            "meals_per_day": item.meals_per_day,
        }
        for item in sorted(
            (item for item in history if item.effective_from <= period_to),
            key=lambda item: item.effective_from,
        )
    ]


def _active_prescription(history: list[Any], day: date) -> Any | None:
    """Назначение, действовавшее в этот день: последнее, начавшееся не позже."""

    active = [item for item in history if item.effective_from <= day]
    return max(active, key=lambda item: item.effective_from) if active else None


def _seizures(rows: list[Any], period_from: date, period_to: date) -> dict[str, Any]:
    by_type: dict[uuid.UUID, dict[str, Any]] = {}
    by_week: dict[date, int] = defaultdict(int)
    days: set[date] = set()

    for row in rows:
        entry = by_type.setdefault(
            row.seizure_type_id, {"name_ru": row.name_ru, "entries": 0, "count": 0}
        )
        entry["entries"] += 1
        entry["count"] += row.count
        day = row.occurred_at.date()
        days.add(day)
        by_week[_week_start(day)] += row.count

    return {
        "entries": len(rows),
        "count": sum(row.count for row in rows),
        "days_with_seizures": len(days),
        # Самая длинная череда дней без единой записи о приступе. Именно без
        # записи: молчание дневника и отсутствие приступов — разные вещи, и
        # раздел «Замечания по данным» существует ровно поэтому.
        "longest_days_without_records": _longest_run(days, period_from, period_to),
        "by_type": sorted(by_type.values(), key=lambda item: -int(item["count"])),
        "by_week": [
            {"week_start": week.isoformat(), "count": count}
            for week, count in sorted(by_week.items())
        ],
    }


def _ketones(rows: list[Any]) -> dict[str, Any]:
    """Кетоны раздельно по методу.

    Кровь и моча в один ряд не сводятся: сопоставимость шкал — открытый вопрос
    14 в `docs/medical/OPEN_QUESTIONS.md`, а среднее по несопоставимым величинам
    хуже, чем два отдельных числа.
    """

    result: dict[str, Any] = {}
    for method in KetoneMethod:
        selected = [row for row in rows if row.method is method]
        values = [float(row.value) for row in selected]
        by_week: dict[date, list[float]] = defaultdict(list)
        for row in selected:
            by_week[_week_start(row.occurred_at.date())].append(float(row.value))

        result[method.value] = {
            **_series_stats(values),
            "days_measured": len({row.occurred_at.date() for row in selected}),
            "by_week": [
                {
                    "week_start": week.isoformat(),
                    "measurements": len(week_values),
                    "min": _round(min(week_values)),
                    "max": _round(max(week_values)),
                    "mean": _mean(week_values),
                }
                for week, week_values in sorted(by_week.items())
            ],
        }
    return result


def _weight(rows: list[Any]) -> dict[str, Any]:
    if not rows:
        return {"measurements": 0, "first": None, "last": None, "delta_kg": None}

    first, last = rows[0], rows[-1]
    heights = [float(row.height_cm) for row in rows if row.height_cm is not None]
    return {
        "measurements": len(rows),
        "first": {
            "date": first.occurred_at.date().isoformat(),
            "kg": _round(float(first.weight_kg)),
        },
        "last": {"date": last.occurred_at.date().isoformat(), "kg": _round(float(last.weight_kg))},
        "delta_kg": _round(float(last.weight_kg) - float(first.weight_kg)),
        "height_cm_first": _round(heights[0], 1) if heights else None,
        "height_cm_last": _round(heights[-1], 1) if heights else None,
    }


def _menu(
    adherence: Any, menu_days: list[Any], history: list[Any], days_in_period: int
) -> dict[str, Any]:
    """Выполнение меню и среднее отклонение спланированных дней от назначения.

    Отклонение считается по каждому дню против назначения, действовавшего
    именно в этот день: сравнивать август с сентябрьским назначением значит
    показать врачу расхождение, которого не было.

    Калорийность сравнивается со СУТОЧНОЙ нормой, а день мог быть спланирован не
    до конца — из-за этого отклонение систематически уходит в минус (открытый
    вопрос 9). Поэтому число называется отклонением плана, а не недобором.
    """

    ratio_deviations: list[float] = []
    kcal_deviations: list[float] = []
    versions: set[str] = set()

    for day in menu_days:
        prescription = _active_prescription(history, day.date)
        if prescription is None:
            continue
        if day.engine_version:
            versions.add(day.engine_version)
        ratio = day.totals.get("ratio")
        kcal = day.totals.get("kcal")
        if ratio is not None:
            ratio_deviations.append(float(ratio) - float(prescription.ratio))
        if kcal is not None and prescription.kcal_per_day:
            kcal_deviations.append(
                (float(kcal) - float(prescription.kcal_per_day))
                / float(prescription.kcal_per_day)
                * 100
            )

    return {
        "days_in_period": days_in_period,
        "days_planned": adherence.days_planned,
        "items_planned": adherence.items_planned,
        "items_eaten": adherence.items_eaten,
        "days_compared": len(ratio_deviations),
        "ratio_mean_deviation": _mean(ratio_deviations),
        "kcal_mean_deviation_pct": _round(_mean(kcal_deviations) or 0.0, 1)
        if kcal_deviations
        else None,
        "engine_versions": sorted(versions),
    }


def _coverage(
    entry_days: list[date], period_from: date, period_to: date, days_in_period: int
) -> dict[str, Any]:
    days = set(entry_days)
    return {
        "days_in_period": days_in_period,
        "days_with_entries": len(days),
        "share_pct": round(len(days) / days_in_period * 100, 1) if days_in_period else None,
        "longest_gap_days": _longest_run(days, period_from, period_to),
        "gaps": _gaps(days, period_from, period_to),
    }
