"""Параметризованные эталонные тесты keto_engine (раздел 6.4 ТЗ).

Загружает все сценарии из `docs/medical/reference-cases/*.yaml`. Эталоны —
provisional: рассчитаны вручную по формулам ТЗ (раздел 6.2/6.3), независимо
от кода `keto_engine.engine` (см. скрипт-генератор, не входящий в репозиторий).
Падает эталонный тест — правится код, не эталон (правило 2, CLAUDE.md).
"""

from __future__ import annotations

from typing import Any

import pytest
import yaml

from keto_engine import (
    DishResult,
    InfeasibleError,
    Ingredient,
    SolveResult,
    Targets,
    scale,
    solve,
    verify,
)
from keto_engine.constants import GRAM_ROUNDING, KCAL_TOLERANCE_FRACTION, RATIO_TOLERANCE

from .conftest import REFERENCE_CASES_DIR


def _load_cases() -> list[tuple[str, dict[str, Any]]]:
    paths = sorted(REFERENCE_CASES_DIR.glob("*.yaml"))
    assert len(paths) >= 30, (
        f"Ожидается минимум 30 эталонных сценариев (раздел 6.4 ТЗ), найдено {len(paths)}"
    )
    cases = []
    for path in paths:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert data.get("provisional") is True, (
            f"{path.name}: временный эталон должен быть provisional: true"
        )
        cases.append((path.stem, data))
    return cases


CASES = _load_cases()


def _build_ingredients(raw: list[dict[str, Any]]) -> dict[str, Ingredient]:
    return {
        item["product_id"]: Ingredient(
            product_id=item["product_id"],
            kcal=item["kcal"],
            fat=item["fat"],
            protein=item["protein"],
            carbs=item["carbs"],
            fiber=item.get("fiber", 0.0),
        )
        for item in raw
    }


def _build_targets(raw: dict[str, Any]) -> Targets:
    bounds = raw.get("per_ingredient_bounds")
    if bounds is not None:
        bounds = {pid: tuple(v) for pid, v in bounds.items()}
    return Targets(
        ratio=raw["ratio"],
        kcal=raw["kcal"],
        protein_min_g=raw.get("protein_min_g"),
        carbs_max_g=raw.get("carbs_max_g"),
        per_ingredient_bounds=bounds,
        net_carbs=raw.get("net_carbs", False),
    )


def _assert_dish_matches(dish: DishResult, expected: dict[str, Any], tol: float) -> None:
    assert dish.kcal == pytest.approx(expected["kcal"], abs=tol)
    assert dish.fat_g == pytest.approx(expected["fat_g"], abs=tol)
    assert dish.protein_g == pytest.approx(expected["protein_g"], abs=tol)
    assert dish.carbs_g == pytest.approx(expected["carbs_g"], abs=tol)
    assert dish.fiber_g == pytest.approx(expected["fiber_g"], abs=tol)
    if expected["ratio"] is None:
        assert dish.ratio is None
    else:
        assert dish.ratio == pytest.approx(expected["ratio"], abs=tol)


@pytest.mark.parametrize("name,case", CASES, ids=[c[0] for c in CASES])
def test_reference_case(name: str, case: dict[str, Any]) -> None:
    operation = case["operation"]
    raw_input = case["input"]
    expected = case["expected"]
    tol = case.get("tolerance", {}).get("abs", 1e-6)

    if operation == "verify":
        ingredients = _build_ingredients(raw_input["ingredients"])
        items = [(ingredients[i["product_id"]], i["grams"]) for i in raw_input["items"]]
        dish = verify(items)
        _assert_dish_matches(dish, expected, tol)

    elif operation == "scale":
        ingredients = _build_ingredients(raw_input["ingredients"])
        recipe_items = [
            (ingredients[i["product_id"]], i["grams"]) for i in raw_input["recipe_items"]
        ]
        recipe = verify(recipe_items)
        scaled = scale(recipe, raw_input["factor"])
        _assert_dish_matches(scaled, expected, tol)

    elif operation == "solve":
        ingredients = list(_build_ingredients(raw_input["ingredients"]).values())
        targets = _build_targets(raw_input["targets"]) if raw_input.get("targets") else None

        if expected["infeasible"]:
            with pytest.raises(InfeasibleError) as exc_info:
                solve(ingredients, targets)
            reason_substr = expected.get("reason_contains")
            if reason_substr:
                assert reason_substr in exc_info.value.reason
        else:
            result = solve(ingredients, targets)
            _assert_solve_result_valid(result, ingredients, targets)

    else:
        raise AssertionError(f"Неизвестная операция в эталоне: {operation}")


def _assert_solve_result_valid(
    result: SolveResult, ingredients: list[Ingredient], targets: Targets
) -> None:
    """Независимая проверка инвариантов решения (не полагается на поля SolveResult,
    кроме списка использованных масс — пересчитывает сама)."""

    dish = result.dish
    used = {item.ingredient.product_id: item.grams for item in dish.items}
    by_id = {i.product_id: i for i in ingredients}

    fat = protein = carbs = 0.0
    for pid, grams in used.items():
        ing = by_id[pid]
        factor = grams / 100.0
        fat += ing.fat * factor
        protein += ing.protein * factor
        carbs += ing.carbs * factor
    kcal = fat * 9.0 + protein * 4.0 + carbs * 4.0
    ratio = fat / (protein + carbs) if (protein + carbs) > 0 else None

    assert ratio is not None, "solve() вернул блюдо без белков/углеводов — ratio не определён"
    assert ratio == pytest.approx(targets.ratio, abs=RATIO_TOLERANCE)
    assert kcal == pytest.approx(targets.kcal, rel=KCAL_TOLERANCE_FRACTION + 1e-9)

    # Итоговые массы округлены до GRAM_ROUNDING (constants.py) уже после решения LP,
    # поэтому пограничные (активные) ограничения могут быть нарушены на пренебрежимо
    # малую, но не бесконечно малую величину — допуск ниже это учитывает.
    rounding_slack = max(1.0, GRAM_ROUNDING)
    if targets.protein_min_g is not None:
        assert protein >= targets.protein_min_g - rounding_slack
    if targets.carbs_max_g is not None:
        assert carbs <= targets.carbs_max_g + rounding_slack
    if targets.per_ingredient_bounds:
        for pid, (lo, hi) in targets.per_ingredient_bounds.items():
            grams = used.get(pid, 0.0)
            assert grams >= lo - rounding_slack
            if hi is not None:
                assert grams <= hi + rounding_slack

    assert result.ratio_within_tolerance is True
    assert result.kcal_within_tolerance is True
