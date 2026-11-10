"""Build the per-100 g product table of the DMTT 2025 menus from their transcribed rows.

The published documents give nutrients per portion and calculate them on the GROSS mass, so the
values per 100 g are derived from the gross column. The rule is deterministic: a value that
cannot be derived from agreeing rows is rejected and reported, never corrected by hand.

Usage: python infra/scripts/build_dmtt_standard.py [--check]
"""

from __future__ import annotations

import csv
import io
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "seed" / "dmtt-2025"

#: Below this gross mass the two-decimal rounding of the source distorts the value per 100 g.
MIN_GROSS_G = 5.0
MIN_AGREEING_ROWS = 3
RELATIVE_TOLERANCE = 0.10
#: Macros near zero cannot agree relatively: 0.1 g against 0.2 g is rounding, not a discrepancy.
ABSOLUTE_MACRO_TOLERANCE_G = 0.5
ATWATER_TOLERANCE = 0.10
#: Equal values in two product groups mean a copied line: walnuts printed with the numbers of raisins.
COPIED_VALUES_TOLERANCE = 0.01

#: The source lists no energy for these; they carry none.
ZERO_VALUE_KEYS = frozenset({"water", "salt"})
#: Clinic answer to question 16 (ADR-0054): salt is not counted in calculations.
NOT_COUNTED_KEYS = frozenset({"salt"})

SOURCE = "Yagona mavsumiy taomnoma, SanQvaM 0016-21"
SOURCE_VERSION = "2025, per 100 g derived from gross mass"
VERIFIED_AT = "2026-11-09"

PRODUCT_COLUMNS = (
    "name_ru",
    "name_uz",
    "name_en",
    "category",
    "kcal_100g",
    "fat_100g",
    "protein_100g",
    "carbs_100g",
    "fiber_100g",
    "source",
    "source_version",
    "verified_at",
    "counts_in_calculation",
)


@dataclass(frozen=True, slots=True)
class Per100g:
    kcal: float
    fat: float
    protein: float
    carbs: float


@dataclass(frozen=True, slots=True)
class SourceRow:
    doc: str
    page: int
    key: str
    gross_g: float
    values: Per100g


@dataclass(frozen=True, slots=True)
class Decision:
    key: str
    usable_rows: int
    agreeing_rows: int
    values: Per100g | None
    reason: str | None


def _number(text: str) -> float | None:
    return float(text) if text else None


def read_rows(path: Path) -> list[SourceRow]:
    """Rows with all nutrient cells present and enough gross mass to be meaningful."""

    usable: list[SourceRow] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            gross = _number(row["gross_g"])
            cells = [_number(row[c]) for c in ("kcal", "fat_g", "protein_g", "carbs_g")]
            if gross is None or gross < MIN_GROSS_G or None in cells:
                continue
            kcal, fat, protein, carbs = (float(c or 0) / gross * 100 for c in cells)
            if kcal <= 0:
                continue
            usable.append(
                SourceRow(
                    row["doc"],
                    int(row["page"]),
                    row["product_key"],
                    gross,
                    Per100g(kcal, fat, protein, carbs),
                )
            )
    return usable


def _median_of(rows: list[SourceRow]) -> Per100g:
    return Per100g(
        statistics.median(r.values.kcal for r in rows),
        statistics.median(r.values.fat for r in rows),
        statistics.median(r.values.protein for r in rows),
        statistics.median(r.values.carbs for r in rows),
    )


def _macro_agrees(value: float, reference: float) -> bool:
    return abs(value - reference) <= max(ABSOLUTE_MACRO_TOLERANCE_G, reference * RELATIVE_TOLERANCE)


def agrees(row: Per100g, reference: Per100g) -> bool:
    return (
        abs(row.kcal - reference.kcal) <= reference.kcal * RELATIVE_TOLERANCE
        and _macro_agrees(row.fat, reference.fat)
        and _macro_agrees(row.protein, reference.protein)
        and _macro_agrees(row.carbs, reference.carbs)
    )


def atwater_kcal(values: Per100g) -> float:
    return 9 * values.fat + 4 * values.protein + 4 * values.carbs


def decide(key: str, rows: list[SourceRow]) -> Decision:
    if not rows:
        return Decision(key, 0, 0, None, "нет строк с полными значениями")
    reference = _median_of(rows)
    agreeing = [r for r in rows if agrees(r.values, reference)]
    if len(agreeing) < MIN_AGREEING_ROWS:
        return Decision(
            key,
            len(rows),
            len(agreeing),
            None,
            f"согласующихся строк меньше {MIN_AGREEING_ROWS}",
        )
    values = _median_of(agreeing)
    if abs(atwater_kcal(values) - values.kcal) > values.kcal * ATWATER_TOLERANCE:
        return Decision(
            key,
            len(rows),
            len(agreeing),
            None,
            f"калорийность {values.kcal:.0f} не сходится с расчётом 9-4-4 "
            f"({atwater_kcal(values):.0f})",
        )
    return Decision(key, len(rows), len(agreeing), values, None)


def _same_values(first: Per100g, second: Per100g) -> bool:
    pairs = (
        (first.kcal, second.kcal),
        (first.fat, second.fat),
        (first.protein, second.protein),
        (first.carbs, second.carbs),
    )
    return all(abs(a - b) <= max(0.05, b * COPIED_VALUES_TOLERANCE) for a, b in pairs)


def reject_copied(decisions: list[Decision], names: dict[str, dict[str, str]]) -> list[Decision]:
    """Reject products whose values repeat those of a product from another group.

    Agreement between rows cannot catch this: a copied line agrees with its own copies.
    """

    result = []
    for decision in decisions:
        twin = next(
            (
                other.key
                for other in decisions
                if decision.values is not None
                and other.values is not None
                and other.key != decision.key
                and names[other.key]["category"] != names[decision.key]["category"]
                and _same_values(decision.values, other.values)
            ),
            None,
        )
        if twin is None:
            result.append(decision)
        else:
            result.append(
                Decision(
                    decision.key,
                    decision.usable_rows,
                    decision.agreeing_rows,
                    None,
                    f"значения совпадают с продуктом другой группы ({names[twin]['name_ru']})",
                )
            )
    return result


def _yes_no(key: str) -> str:
    return "нет" if key in NOT_COUNTED_KEYS else "да"


def render_products(names: dict[str, dict[str, str]], decisions: list[Decision]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(PRODUCT_COLUMNS)
    for decision in sorted(decisions, key=lambda d: names[d.key]["name_ru"]):
        name = names[decision.key]
        if decision.key in ZERO_VALUE_KEYS:
            values = Per100g(0, 0, 0, 0)
        elif decision.values is None:
            continue
        else:
            values = decision.values
        writer.writerow(
            [
                name["name_ru"],
                name["name_uz"],
                "",
                name["category"],
                f"{values.kcal:.2f}",
                f"{values.fat:.2f}",
                f"{values.protein:.2f}",
                f"{values.carbs:.2f}",
                "0.00",
                SOURCE,
                SOURCE_VERSION,
                VERIFIED_AT,
                _yes_no(decision.key),
            ]
        )
    return out.getvalue()


def render_report(
    names: dict[str, dict[str, str]], decisions: list[Decision], rows: list[SourceRow]
) -> str:
    published = [d for d in decisions if d.values is not None or d.key in ZERO_VALUE_KEYS]
    rejected = [d for d in decisions if d.values is None and d.key not in ZERO_VALUE_KEYS]
    by_key = {d.key: d for d in decisions}
    lines = [
        "# Отчёт о выводе значений DMTT 2025",
        "",
        "Файл создан `infra/scripts/build_dmtt_standard.py`, руками не правится.",
        "",
        f"Продуктов всего: {len(decisions)}. Включено: {len(published)}. "
        f"Отклонено: {len(rejected)}.",
        "",
        "## Отклонённые продукты",
        "",
        "| Продукт | Строк с данными | Согласуются | Причина |",
        "| --- | --- | --- | --- |",
    ]
    for d in sorted(rejected, key=lambda d: names[d.key]["name_ru"]):
        lines.append(
            f"| {names[d.key]['name_ru']} | {d.usable_rows} | {d.agreeing_rows} | {d.reason} |"
        )
    lines += [
        "",
        "## Строки включённых продуктов, разошедшиеся с итогом",
        "",
        "Значения строк на 100 г брутто. В расчёт эти строки не вошли.",
        "",
        "| Документ | Стр. | Продукт | Брутто, г | Ккал | Жиры | Белки | Углеводы | Итог, ккал |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in sorted(rows, key=lambda r: (r.doc, r.page, r.key, r.gross_g)):
        reference = by_key[row.key].values
        if reference is None or agrees(row.values, reference):
            continue
        v = row.values
        lines.append(
            f"| {row.doc} ч | {row.page} | {names[row.key]['name_ru']} | {row.gross_g:g} | "
            f"{v.kcal:.0f} | {v.fat:.1f} | {v.protein:.1f} | {v.carbs:.1f} | {reference.kcal:.0f} |"
        )
    return "\n".join(lines) + "\n"


def build() -> tuple[str, str]:
    with (DATA_DIR / "product_names.csv").open(encoding="utf-8", newline="") as handle:
        names = {row["key"]: row for row in csv.DictReader(handle)}
    rows = read_rows(DATA_DIR / "source_rows.csv")
    decisions = []
    for key in names:
        decisions.append(decide(key, [r for r in rows if r.key == key]))
    decisions = reject_copied(decisions, names)
    return render_products(names, decisions), render_report(names, decisions, rows)


def main() -> int:
    products, report = build()
    outputs = {DATA_DIR / "products.csv": products, DATA_DIR / "REPORT.md": report}
    if "--check" in sys.argv:
        stale = [p.name for p, text in outputs.items() if p.read_text(encoding="utf-8") != text]
        if stale:
            print(f"out of date: {', '.join(stale)}", file=sys.stderr)
            return 1
        return 0
    for path, text in outputs.items():
        path.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
