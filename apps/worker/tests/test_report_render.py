"""Сборка HTML отчёта (раздел 7.5 ТЗ).

Проверяется именно HTML, а не PDF: weasyprint тянет системные библиотеки, и
тест, падающий на машине без pango, ничего не говорит о правильности отчёта.
"""

from __future__ import annotations

import os

import pytest

from worker.reports.render import (
    FONTS,
    age_text,
    format_number,
    format_period,
    html_to_pdf,
    render_html,
)
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
    "ketones_blood": {
        "points": [{"at": "2026-08-02T08:00:00+00:00", "value": 3.2}],
        "min": 3.2,
        "max": 3.2,
        "mean": 3.2,
    },
    "ketones_urine": {"points": [], "min": None, "max": None, "mean": None},
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
    # Число приступов стоит один раз — в сводных числах, без повтора строкой.
    assert '<p class="value">6</p>' in html
    assert "Всего приступов" not in html
    assert "Леветирацетам" in html


LETTERHEAD = {
    "name_uz": "«Namuna» bolalar nevrologiya markazi",
    "name_ru": "Детский неврологический центр «Образец»",
    "short_name": "ДНЦ «Образец»",
    "department": None,
    "address": "г. Ташкент, ул. Образцовая, 1",
    "family_phone": None,
    "contact": None,
    "license": "№ 00000 от 01.02.2023",
    "stir": None,
    "logo_data_uri": None,
}
DOCUMENT = {
    "letterhead": LETTERHEAD,
    "author": {"name": "Иванова Анна Петровна", "role": "doctor"},
}


def test_numbers_and_dates_are_written_the_russian_way():
    """Правило П45 и ADR-0092: «1 200», «3,2», «05.08.2026» — а не «1200», «3.2», ISO."""

    html = render_html(REPORT, title="Отчёт", document=DOCUMENT)

    assert "1\u00a0200" in html
    assert "3,2" in html
    assert "05.08.2026" in html
    assert "2026-08-05" not in html.split("<body>")[1]
    assert "Отчёт за 1–31 августа 2026 г." in html
    # Соотношение — исключение раздела 8.2 ТЗ: точка.
    assert "4.0 : 1" in html


def test_letterhead_author_and_footer():
    html = render_html(REPORT, title="Отчёт", document=DOCUMENT)

    assert "«Namuna» bolalar nevrologiya markazi" in html
    assert "Лицензия № 00000 от 01.02.2023" in html
    assert "ДНЦ «Образец»" in html
    assert "сформировал(а) Иванова Анна Петровна, врач" in html
    assert "Медицинские сведения, конфиденциально" in html
    assert "KC-REPORT-2" in html
    # Версии расчётного ядра в отчёте нет: рассчитанных ядром чисел он не несёт.
    assert "расчёт" not in html
    # 10:00 UTC — 15:00 по часам клиники; пояс назван смещением, а не городом,
    # зашитым в шаблон.
    assert "01.09.2026 в 15:00 (UTC+5)" in html


def test_without_a_letterhead_the_product_signs_it():
    """Задача, поставленная прежней версией API, приходит без бланка."""

    html = render_html(REPORT, title="Отчёт")

    assert "KetoCare" in html
    assert "сформировал(а)" not in html


def test_card_number_is_on_every_page():
    """Номер карты — второй идентификатор рядом с датой рождения (RCP, ADR-0092):
    в блоке пациента и в колонтитуле, который повторяется на каждой странице."""

    with_card = {**REPORT, "patient": {**REPORT["patient"], "clinic_card_number": "0142"}}

    html = render_html(with_card, title="Отчёт", document=DOCUMENT)

    assert "№ карты клиники 0142" in html
    assert "12.04.2019 · № 0142" in html


def test_ketone_chart_only_with_blood_readings():
    html = render_html(REPORT, title="Отчёт")
    assert "Кетоны в крови по дням и приступы" in html

    no_readings = {
        **REPORT,
        "ketones_blood": {"points": [], "min": None, "max": None, "mean": None},
    }
    assert "Кетоны в крови по дням и приступы" not in render_html(no_readings, title="Отчёт")


@pytest.mark.parametrize(
    ("value", "digits", "expected"),
    [(1300, 0, "1\u00a0300"), (3.45, 1, "3,5"), (None, 1, "—"), (12345.678, 2, "12\u00a0345,68")],
)
def test_format_number(value, digits, expected):
    assert format_number(value, digits) == expected


def test_age_text():
    assert age_text("2025-01-15", "2026-11-18") == "22 месяца"
    assert age_text("2020-03-12", "2026-11-18") == "6 лет"
    assert age_text("2024-11-19", "2026-11-18") == "23 месяца"


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

    assert "На конец периода назначения нет." in html
    assert "В периоде назначение не действовало." in html
    assert "За период приступов не записано." in html
    assert "В периоде препаратов в схеме терапии нет." in html


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


def test_report_renders_to_a4_without_running_away():
    """Печатный лист, а не экран: A4, а отчёт за месяц с одним препаратом — не
    больше двух листов. С бланком клиники, сводными числами и графиком (ADR-0092)
    первая страница занята обзором, таблицы уходят на вторую.

    Проверка идёт через weasyprint и требует системных pango и cairo — на машине
    без них тест пропускается, а не падает: его отсутствие ничего не говорит о
    правильности отчёта (см. apps/worker/README.md). В CI стоит
    KETOCARE_REQUIRE_PDF=1, и пропуск становится падением: иначе путь, печатающий
    отчёт врачу, мог бы молча перестать исполняться.
    """
    try:
        import weasyprint
    except (ImportError, OSError) as error:
        # Именно OSError: системные библиотеки грузятся уже на импорте, и
        # `pytest.importorskip` его не ловит — он ждёт ImportError.
        reason = f"weasyprint без системных библиотек: {error}"
        if os.environ.get("KETOCARE_REQUIRE_PDF"):
            pytest.fail(reason)
        pytest.skip(reason)

    document = weasyprint.HTML(
        string=render_html(REPORT, title="Отчёт по пациенту", document=DOCUMENT),
        base_url=str(FONTS.parent) + "/",
    ).render()

    assert 1 <= len(document.pages) <= 2
    # A4 в пикселях CSS: 210 x 297 мм при 96 dpi
    assert round(document.pages[0].width * 25.4 / 96) == 210
    assert round(document.pages[0].height * 25.4 / 96) == 297


def _inflated(pdf: bytes) -> bytes:
    """PDF с распакованными потоками: имена шрифтов лежат в сжатых объектах."""

    import re
    import zlib

    parts = [pdf]
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            parts.append(zlib.decompress(match.group(1)))
        except zlib.error:
            continue
    return b"".join(parts)


def _require_weasyprint():
    try:
        import weasyprint  # noqa: F401
    except (ImportError, OSError) as error:
        reason = f"weasyprint без системных библиотек: {error}"
        if os.environ.get("KETOCARE_REQUIRE_PDF"):
            pytest.fail(reason)
        pytest.skip(reason)


def test_pdf_embeds_the_package_font_and_metadata():
    """Шрифт — из пакета, не из системы (ADR-0092): на сервере без Noto Sans
    отчёт иначе набирался бы чем придётся."""

    _require_weasyprint()

    pdf = html_to_pdf(render_html(REPORT, title="Отчёт по пациенту", document=DOCUMENT))

    assert pdf.startswith(b"%PDF")
    assert b"Noto" in _inflated(pdf)


def test_pdf_refuses_outside_resources():
    """Отчёт несёт ввод человека: ни одна строка не должна увести weasyprint
    в сеть или к чужому файлу. Чужой ресурс не загружается, документ собирается."""

    _require_weasyprint()
    from worker.reports.render import _fetcher

    fetcher = _fetcher()
    for url in ("https://example.com/x.png", "file:///etc/passwd"):
        with pytest.raises(ValueError):
            fetcher.fetch(url)
    fetcher.fetch((FONTS / "NotoSans-Regular.ttf").as_uri())


def test_counts_agree_with_their_words_and_a_single_reading_has_no_range():
    """Аудит документов 20.11.2026: «1 замеров» и «от 18,0 до 18,0» при одном
    взвешивании — мелочи, по которым врач судит, можно ли верить листу."""

    one = {
        **REPORT,
        "ketones_blood": {
            "points": [{"at": "2026-08-10T04:00:00+00:00", "value": 3.2}],
            "min": 3.2,
            "max": 3.2,
            "mean": 3.2,
        },
        "weight": {
            "points": [{"at": "2026-08-10T04:00:00+00:00", "value": 18.0}],
            "min": 18.0,
            "max": 18.0,
            "mean": 18.0,
        },
    }

    html = render_html(one, title="Отчёт")

    assert "1 замер<" in html
    assert "1 взвешивание<" in html
    assert "от 18,0 до 18,0" not in html
    assert "от 3,2 до 3,2" not in html


def test_one_day_period_is_one_date():
    assert format_period("2026-11-05", "2026-11-05") == "5 ноября 2026 г."
    assert format_period("2026-11-01", "2026-11-18") == "1–18 ноября 2026 г."


def test_summaries_are_mentioned_only_when_the_report_has_them():
    """Фраза «сводки включены в подтверждённом виде» в отчёте без сводок —
    у семьи их нет никогда — обещала раздел, которого на листе нет."""

    html = render_html(REPORT, title="Отчёт")
    assert "Сводки" not in html.split("<body>")[1]
