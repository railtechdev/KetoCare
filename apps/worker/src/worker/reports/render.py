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

Оформление — единый стандарт документов (ADR-0092): бланк клиники на первой
странице, короткий колонтитул со второй, подвал с «Стр. X из Y» на каждой,
шрифт Noto Sans из пакета (а не системный), числа по-русски.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATES = Path(__file__).parent
FONTS = _TEMPLATES / "fonts"

#: Шифр шаблона в подвале: по нему видно, какой версией напечатан лист.
TEMPLATE_CODE = "KC-REPORT-2"

_MONTHS_GENITIVE = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)

#: Неразрывный пробел между разрядами: «1 300» не переносится по строкам.
_GROUP = " "


@cache
def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(_TEMPLATES),
        # Экранирование обязательно: в отчёт попадают ФИО, названия препаратов,
        # описания приступов и подтверждённая сводка врача — всё это ввод человека.
        autoescape=select_autoescape(["html"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters.update(
        num=format_number,
        day=format_date,
        kcal=format_kcal,
        meals=lambda n: _plural(int(n), "приём", "приёма", "приёмов"),
        readings=lambda n: _plural(int(n), "замер", "замера", "замеров"),
        weighings=lambda n: _plural(int(n), "взвешивание", "взвешивания", "взвешиваний"),
    )
    return env


# --- числа и даты -------------------------------------------------------------


def format_number(value: float | int | None, digits: int = 1) -> str:
    """«1 300», «3,4»: запятая и неразрывный пробел между разрядами (правило П45)."""

    if value is None:
        return "—"
    text = f"{value:,.{digits}f}".replace(",", _GROUP).replace(".", ",")
    return text


def format_kcal(value: float | int | None) -> str:
    return format_number(value, 0)


def _as_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(value[:10])


def format_date(value: str | date | None) -> str:
    """Дата в таблице: «05.11.2026»."""

    if value is None:
        return "—"
    return _as_date(value).strftime("%d.%m.%Y")


def format_period(start: str | date, end: str | date) -> str:
    """Период словами: «1–18 ноября 2026 г.», через месяцы — числами."""

    a, b = _as_date(start), _as_date(end)
    if a == b:
        return f"{a.day} {_MONTHS_GENITIVE[a.month - 1]} {a.year} г."
    if a.year == b.year and a.month == b.month:
        return f"{a.day}–{b.day} {_MONTHS_GENITIVE[b.month - 1]} {b.year} г."
    return f"{format_date(a)} – {format_date(b)}"


def utc_offset(moment: datetime) -> str:
    """«UTC+5», «UTC+5:30»: часы, по которым стоит время на листе.

    Смещение берётся из самого момента: название города было бы зашито в код и
    неверно для клиники в другом поясе.
    """

    offset = moment.utcoffset() or timedelta(0)
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "−"
    hours, rest = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours}" + (f":{rest:02d}" if rest else "")


def _local(value: str, tz: str) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment.astimezone(ZoneInfo(tz))


def age_text(birth: str | date, on: str | date) -> str:
    """Возраст на конец периода: до двух лет — в месяцах (как в карте пациента)."""

    born, day = _as_date(birth), _as_date(on)
    months = (day.year - born.year) * 12 + day.month - born.month - (day.day < born.day)
    if months < 24:
        return f"{months} {_plural(months, 'месяц', 'месяца', 'месяцев')}"
    years = months // 12
    return f"{years} {_plural(years, 'год', 'года', 'лет')}"


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


# --- график -------------------------------------------------------------------


@dataclass(frozen=True)
class Chart:
    """Кетоны в крови по дням и приступы — SVG, который читается в оттенках серого:
    линия с маркерами, приступы — треугольники с числом на отдельной дорожке."""

    width: int
    height: int
    plot_top: int
    plot_bottom: int
    left: int
    line: str
    dots: list[tuple[float, float]]
    grid: list[tuple[float, str]]
    seizures: list[tuple[float, int]]
    seizure_y: int
    ticks: list[tuple[float, str]]
    label: str


def ketone_chart(report: dict[str, Any], tz: str) -> Chart | None:
    """Среднее за день по крови; нет замеров — графика нет (таблица ниже скажет)."""

    points = report["ketones_blood"]["points"]
    if not points:
        return None
    start = _as_date(report["period"]["from_date"])
    end = _as_date(report["period"]["to_date"])
    days = max((end - start).days, 1)

    by_day: dict[date, list[float]] = {}
    for point in points:
        by_day.setdefault(_local(point["at"], tz).date(), []).append(point["value"])
    daily = sorted((day, sum(v) / len(v)) for day, v in by_day.items())

    width, left, right = 642, 34, 8
    plot_top, plot_bottom = 12, 150
    seizure_y = 176
    top_value = max(6.0, max(value for _, value in daily))
    scale = (plot_bottom - plot_top) / top_value

    def x(day: date) -> float:
        return round(left + (width - left - right) * (day - start).days / days, 1)

    def y(value: float) -> float:
        return round(plot_bottom - value * scale, 1)

    dots = [(x(day), y(value)) for day, value in daily]
    grid = [(y(v), format_number(v, 0)) for v in range(0, int(top_value) + 1, 2)]
    seizures = [
        (x(_as_date(day)), count)
        for day, count in sorted(report["seizures"]["by_day"].items())
        if count > 0 and start <= _as_date(day) <= end
    ]
    step = 5 if days > 10 else 1
    tick_days = [start.toordinal() + i for i in range(0, days + 1, step)]
    ticks = [(x(date.fromordinal(d)), date.fromordinal(d).strftime("%d.%m")) for d in tick_days]
    low = min(daily, key=lambda item: item[1])
    high = max(daily, key=lambda item: item[1])
    spread = (
        f"{format_number(low[1])}"
        if low[1] == high[1]
        else f"от {format_number(low[1])} до {format_number(high[1])}"
    )
    label = f"Кетоны в крови {spread} ммоль/л, приступов за период: {report['seizures']['count']}"
    return Chart(
        width=width,
        height=196,
        plot_top=plot_top,
        plot_bottom=plot_bottom,
        left=left,
        line=" ".join(f"{px},{py}" for px, py in dots),
        dots=dots,
        grid=grid,
        seizures=seizures,
        seizure_y=seizure_y,
        ticks=ticks,
        label=label,
    )


# --- сборка -------------------------------------------------------------------


_ROLE_RU = {"doctor": "врач", "dietitian": "диетолог", "parent": "родитель"}


def render_html(
    report: dict[str, Any],
    *,
    title: str,
    document: dict[str, Any] | None = None,
    tz: str = "Asia/Tashkent",
) -> str:
    """Отчёт → HTML печатного листа.

    `document` — то, что API приложил к задаче: бланк клиники на момент заказа
    и кто заказал. Задача, поставленная до этой версии, приходит без него —
    отчёт тогда подписан названием продукта.
    """

    document = document or {}
    letterhead = {"short_name": "KetoCare", **(document.get("letterhead") or {})}
    author = document.get("author") or {}
    author_line = ", ".join(
        part for part in (author.get("name"), _ROLE_RU.get(author.get("role", ""))) if part
    )
    generated = _local(report["generated_at"], tz)
    patient = report["patient"]
    period = report["period"]
    return (
        _env()
        .get_template("template.html")
        .render(
            title=title,
            letterhead=letterhead,
            author_line=author_line,
            generated_text=f"{generated:%d.%m.%Y} в {generated:%H:%M} ({utc_offset(generated)})",
            period_text=format_period(period["from_date"], period["to_date"]),
            age=age_text(patient["birth_date"], period["to_date"]),
            # Список идёт в порядке действия (`prescriptions_in_force` в API):
            # последнее — то, что действовало на конец периода.
            current_prescription=(report["prescriptions"] or [None])[-1],
            chart=ketone_chart(report, tz),
            template_code=TEMPLATE_CODE,
            **report,
        )
    )


def _fetcher() -> Any:
    """Только шрифты пакета и `data:` (логотип в бланке).

    Отчёт несёт ввод человека; ни одна строка не должна заставить weasyprint
    сходить в сеть или прочитать файл за пределами каталога шрифтов.
    """

    from urllib.parse import unquote, urlparse  # noqa: PLC0415

    from weasyprint.urls import URLFetcher  # noqa: PLC0415

    fonts = FONTS.resolve()

    class _PackageOnly(URLFetcher):  # type: ignore[misc]
        def fetch(self, url: str, headers: Any = None) -> Any:
            if url.startswith("file:"):
                path = Path(unquote(urlparse(url).path)).resolve()
                if not path.is_relative_to(fonts):
                    raise ValueError(f"Файл не из каталога шрифтов: {path.name}")
            return super().fetch(url, headers)

    return _PackageOnly(allowed_protocols=("file", "data"))


def html_to_pdf(html: str) -> bytes:
    """HTML → PDF.

    Импорт weasyprint внутри функции: см. модульный докстринг. `base_url` —
    каталог шаблона, чтобы `@font-face` нашёл шрифты пакета.
    """

    from weasyprint import HTML  # noqa: PLC0415

    document = HTML(string=html, base_url=str(_TEMPLATES) + "/", url_fetcher=_fetcher())
    return bytes(document.write_pdf())
