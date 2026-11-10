"""The DMTT product table is reproducible and never carries a value the rule rejected."""

from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_dmtt_standard.py"


@pytest.fixture(scope="module")
def builder() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_dmtt_standard", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def products(builder: ModuleType) -> dict[str, dict[str, str]]:
    with (builder.DATA_DIR / "products.csv").open(encoding="utf-8", newline="") as handle:
        return {row["name_ru"]: row for row in csv.DictReader(handle)}


def _row(builder: ModuleType, values: tuple[float, float, float, float]) -> object:
    return builder.SourceRow("x", 1, "k", 10.0, builder.Per100g(*values))


def test_generated_files_match_the_source_rows(builder: ModuleType) -> None:
    products_text, report_text = builder.build()

    assert (builder.DATA_DIR / "products.csv").read_text(encoding="utf-8") == products_text
    assert (builder.DATA_DIR / "REPORT.md").read_text(encoding="utf-8") == report_text


def test_every_source_row_names_a_known_product(builder: ModuleType) -> None:
    with (builder.DATA_DIR / "product_names.csv").open(encoding="utf-8", newline="") as handle:
        known = {row["key"] for row in csv.DictReader(handle)}
    with (builder.DATA_DIR / "source_rows.csv").open(encoding="utf-8", newline="") as handle:
        used = {row["product_key"] for row in csv.DictReader(handle)}

    assert used == known


def test_values_are_derived_from_gross_mass(products: dict[str, dict[str, str]]) -> None:
    """On net mass beef would read 296 kcal: the source calculates on gross."""

    beef = products["Говядина 1 категории"]

    assert (float(beef["kcal_100g"]), float(beef["fat_100g"])) == (218.0, 16.0)


def test_copied_lines_do_not_reach_the_table(products: dict[str, dict[str, str]]) -> None:
    """Walnuts are printed with the numbers of raisins, zero fat included."""

    assert "Грецкий орех (ядро)" not in products
    assert "Изюм" not in products


def test_unknown_fiber_is_never_subtracted(products: dict[str, dict[str, str]]) -> None:
    assert {row["fiber_100g"] for row in products.values()} == {"0.00"}


def test_salt_is_kept_out_of_the_calculation(products: dict[str, dict[str, str]]) -> None:
    assert products["Соль йодированная"]["counts_in_calculation"] == "нет"


def test_too_few_agreeing_rows_are_rejected(builder: ModuleType) -> None:
    rows = [_row(builder, (100.0, 4.0, 5.0, 11.0)) for _ in range(2)]

    assert builder.decide("k", rows).values is None


def test_energy_that_disagrees_with_macros_is_rejected(builder: ModuleType) -> None:
    rows = [_row(builder, (19.0, 0.0, 1.4, 9.1)) for _ in range(5)]

    decision = builder.decide("k", rows)

    assert decision.values is None
    assert "9-4-4" in decision.reason


def test_outlier_rows_do_not_shift_the_value(builder: ModuleType) -> None:
    good = [_row(builder, (58.0, 3.2, 2.8, 4.7)) for _ in range(4)]
    outlier = [_row(builder, (262.0, 3.0, 7.7, 49.8))]

    decision = builder.decide("k", good + outlier)

    assert decision.values == builder.Per100g(58.0, 3.2, 2.8, 4.7)
    assert decision.agreeing_rows == 4
