"""Сборка PDF-отчёта (раздел 7.5 ТЗ: jinja2 → weasyprint → файл в томе).

Разделено на два шага намеренно:

- `render_html` — чистая функция: данные отчёта → HTML. Проверяется тестами на
  любой машине.
- `html_to_pdf` — тонкая обёртка над weasyprint, которая импортируется **лениво,
  внутри функции**. Библиотека тянет системные pango и cairo, и импорт на
  уровне модуля ронял бы весь воркер там, где их нет, — вместе с задачами,
  которым PDF не нужен.

Данные отчёта собирает API (`api.services.reports.build_report`) и передаёт сюда
готовым словарём: воркер не ходит в БД за показателями второй раз, иначе отчёт
на экране и отчёт в PDF собирались бы разным кодом и однажды разошлись бы.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATES = Path(__file__).parent

_env = Environment(
    loader=FileSystemLoader(_TEMPLATES),
    # Экранирование обязательно: в отчёт попадают ФИО, названия препаратов,
    # описания приступов и подтверждённая сводка врача — всё это ввод человека.
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_html(report: dict[str, Any], *, title: str) -> str:
    """Отчёт → HTML печатного листа."""

    return _env.get_template("template.html").render(title=title, **report)


def html_to_pdf(html: str) -> bytes:
    """HTML → PDF.

    Импорт weasyprint внутри функции: см. модульный докстринг.
    """

    from weasyprint import HTML  # noqa: PLC0415

    return bytes(HTML(string=html).write_pdf())
