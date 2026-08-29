"""Property-based тесты (hypothesis) — раздел 6.4 ТЗ:
- verify(solve(x)) всегда в допусках
- scale(r, 1.0) == r
- монотонность kcal по массам
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from keto_engine import InfeasibleError, Ingredient, Targets, scale, solve, verify
from keto_engine.constants import KCAL_TOLERANCE_FRACTION, RATIO_TOLERANCE

_macro = st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
_grams = st.floats(min_value=0.0, max_value=1000.0, allow_nan=False, allow_infinity=False)


@st.composite
def ingredients(draw, min_size: int = 1, max_size: int = 5):
    n = draw(st.integers(min_value=min_size, max_value=max_size))
    result = []
    for i in range(n):
        fat = draw(_macro)
        protein = draw(_macro)
        carbs = draw(
            st.floats(
                min_value=0.0,
                max_value=100.0 - fat - protein if fat + protein < 100.0 else 0.0,
                allow_nan=False,
                allow_infinity=False,
            )
        )
        fiber = draw(
            st.floats(
                min_value=0.0, max_value=min(carbs, 30.0), allow_nan=False, allow_infinity=False
            )
        )
        kcal = fat * 9 + protein * 4 + carbs * 4
        result.append(
            Ingredient(
                product_id=f"ing_{i}", kcal=kcal, fat=fat, protein=protein, carbs=carbs, fiber=fiber
            )
        )
    return result


@given(
    ings=ingredients(min_size=1, max_size=4),
    factor=st.floats(min_value=0.01, max_value=10.0, allow_nan=False),
)
@settings(max_examples=100)
def test_verify_scale_linear_in_mass(ings: list[Ingredient], factor: float) -> None:
    """verify() линейна по массам: удвоение всех масс удваивает kcal/fat/protein/carbs."""
    base_items = [(ing, 10.0) for ing in ings]
    scaled_items = [(ing, 10.0 * factor) for ing in ings]

    base = verify(base_items)
    scaled = verify(scaled_items)

    assert scaled.kcal == pytest.approx(base.kcal * factor, rel=1e-6, abs=1e-9)
    assert scaled.fat_g == pytest.approx(base.fat_g * factor, rel=1e-6, abs=1e-9)
    assert scaled.protein_g == pytest.approx(base.protein_g * factor, rel=1e-6, abs=1e-9)
    assert scaled.carbs_g == pytest.approx(base.carbs_g * factor, rel=1e-6, abs=1e-9)
    if base.ratio is not None:
        assert scaled.ratio == pytest.approx(
            base.ratio, rel=1e-6, abs=1e-9
        )  # ratio инвариантен к масштабу


@given(ings=ingredients(min_size=1, max_size=4), grams=st.lists(_grams, min_size=1, max_size=4))
@settings(max_examples=100)
def test_kcal_monotonic_in_mass(ings: list[Ingredient], grams: list[float]) -> None:
    """Увеличение массы любого ингредиента не уменьшает суммарную калорийность."""
    n = min(len(ings), len(grams))
    ings, grams = ings[:n], grams[:n]
    items = list(zip(ings, grams, strict=True))
    base = verify(items)

    bumped_items = [(ing, g + 5.0) for ing, g in items]
    bumped = verify(bumped_items)

    assert bumped.kcal >= base.kcal - 1e-9


@given(ings=ingredients(min_size=1, max_size=4))
@settings(max_examples=50)
def test_scale_identity(ings: list[Ingredient]) -> None:
    """scale(r, 1.0) == r"""
    items = [(ing, 10.0 + i) for i, ing in enumerate(ings)]
    recipe = verify(items)
    assert scale(recipe, 1.0) == recipe


@given(
    fat=st.floats(min_value=50.0, max_value=100.0, allow_nan=False),
    protein=st.floats(min_value=0.0, max_value=30.0, allow_nan=False),
    carbs=st.floats(min_value=0.0, max_value=20.0, allow_nan=False),
    ratio=st.sampled_from([2.0, 2.5, 3.0, 3.5, 4.0]),
    kcal_target=st.floats(min_value=200.0, max_value=1200.0, allow_nan=False),
)
@settings(max_examples=60)
def test_solve_result_within_tolerance_when_feasible(
    fat: float, protein: float, carbs: float, ratio: float, kcal_target: float
) -> None:
    """verify(solve(x).dish.items) всегда в допусках, когда solve() не бросает InfeasibleError.

    Один высокожировой продукт заведомо позволяет достичь любого разумного соотношения —
    задача почти всегда разрешима; если всё же нет, InfeasibleError — ожидаемое поведение.
    """
    fat_source = Ingredient("fat_source", kcal=fat * 9, fat=fat, protein=0.0, carbs=0.0, fiber=0.0)
    lean_source = Ingredient(
        "lean_source",
        kcal=protein * 4 + carbs * 4,
        fat=0.0,
        protein=protein + 1.0,
        carbs=carbs,
        fiber=0.0,
    )
    targets = Targets(ratio=ratio, kcal=kcal_target)

    try:
        result = solve([fat_source, lean_source], targets)
    except InfeasibleError:
        return  # допустимый исход — задача действительно может быть неразрешима

    dish = verify([(item.ingredient, item.grams) for item in result.dish.items])
    assert dish.ratio is not None
    assert abs(dish.ratio - ratio) <= RATIO_TOLERANCE
    assert abs(dish.kcal - kcal_target) <= kcal_target * KCAL_TOLERANCE_FRACTION
