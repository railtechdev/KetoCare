"""Сборка HTML отчёта (раздел 7.5 ТЗ).

Проверяется именно HTML, а не PDF: weasyprint тянет системные библиотеки, и
тест, падающий на машине без pango, ничего не говорит о правильности отчёта.
"""

from __future__ import annotations

import pytest

from worker.reports.render import render_html
from worker.reports.task import report_path

REPORT = {
    "generated_at": "2026-09-01T10:00:00+00:00",
    "period": {"from_date": "2026-08-01", "to_date": "2026-08-31"},
    "patient": {
        "id": "00000000-0000-0000-0000-000000000001",
        "full_name": "Аня Иванова",
        "birth_date": "2019-04-12",
        "sex": "f",
        "height_cm": 85.0,
    },
    "prescriptions": [
        {
            "ratio": 4.0,
            "kcal_per_day": 1200,
            "protein_g": 25.0,
            "carbs_limit_g": 10.0,
            "meals_per_day": 3,
            "effective_from": "2026-08-05",
            "created_at": "2026-08-05T09:00:00+00:00",
        }
    ],
    "seizures": {
        "entries": 2,
        "count": 6,
        "by_type": [
            {
                "seizure_type_id": "00000000-0000-0000-0000-000000000002",
                "name_ru": "Абсанс",
                "code": "A",
                "entries": 2,
                "count": 6,
            }
        ],
        "by_day": {"2026-08-10": 6},
    },
    "ketones": {
        "points": [{"at": "2026-08-02T08:00:00+00:00", "value": 3.2}],
        "min": 3.2,
        "max": 3.2,
        "mean": 3.2,
    },
    "weight": {"points": [], "min": None, "max": None, "mean": None},
    "medications": [
        {
            "drug_name": "Леветирацетам",
            "dose": "250 мг",
            "frequency": "2 раза в сутки",
            "started_at": "2026-01-10",
            "stopped_at": None,
        }
    ],
    "side_effects": [],
    "menu": {"days_planned": 20, "items_planned": 60, "items_eaten": 54},
    "summaries": [],
}


def test_report_contains_key_numbers():
    html = render_html(REPORT, title="Отчёт по пациенту")

    assert "Аня Иванова" in html
    assert "4.0 : 1" in html
    assert "Всего приступов: 6" in html
    assert "Леветирацетам" in html


def test_empty_sections_say_so_instead_of_disappearing():
    """Пустой раздел объясняет себя: «данных нет» и «раздела нет» — разные
    сообщения, и врач не должен гадать, какое перед ним."""
    quiet = {
        **REPORT,
        "prescriptions": [],
        "medications": [],
        "seizures": {**REPORT["seizures"], "by_type": [], "count": 0, "entries": 0},
    }

    html = render_html(quiet, title="Отчёт по пациенту")

    assert "Назначение за период не оформлялось." in html
    assert "За период приступов не записано." in html
    assert "Схема терапии не заполнена." in html


def test_user_input_is_escaped():
    """В отчёт попадают ФИО, названия препаратов и сводка врача — всё это ввод
    человека, и HTML из него собирать нельзя."""
    dangerous = {
        **REPORT,
        "patient": {**REPORT["patient"], "full_name": "<script>alert(1)</script>"},
    }

    html = render_html(dangerous, title="Отчёт")

    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_draft_summaries_never_reach_the_report():
    """Черновик Claude в отчёт не попадает (правило 6): шаблон умеет печатать
    только подтверждённое поле."""
    with_summary = {
        **REPORT,
        "summaries": [
            {
                "period_start": "2026-08-01",
                "period_end": "2026-08-31",
                "approved_md": "Динамика положительная.",
            }
        ],
    }

    html = render_html(with_summary, title="Отчёт")

    assert "Динамика положительная." in html
    assert "draft" not in html


def test_file_name_cannot_escape_the_volume():
    """Имя файла не участвует в пути как есть (то же решение, что в ADR-0004)."""
    with pytest.raises(ValueError):
        report_path("./var/reports", "../../etc/passwd")
