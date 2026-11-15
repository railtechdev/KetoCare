"""Property-based тесты (hypothesis) — раздел 6.4 ТЗ:
- verify(solve(x)) всегда в допусках
- scale(r, 1.0) == r
- монотонность kcal по массам

Число примеров задаёт профиль из `conftest.py`, а не декоратор на функции:
настройка на тесте сильнее профиля, и с зашитой сотней перебор не управлялся
ничем. Глубина повышает вероятность находки и не даёт гарантий — на дефекте из
PR #203 повторные прогоны с разными сидами нашли его в одном случае из пяти при
5000 примеров и в двух из трёх при 50000.
"""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from keto_engine import (
    InfeasibleError,
    Ingredient,
    Targets,
    max_non_fat_grams,
    refine,
    scale,
    solve,
    verify,
)
from keto_engine.constants import KCAL_TOLERANCE_FRACTION, RATIO_TOLERANCE
from keto_engine.engine import _totals

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
def test_kcal_monotonic_in_mass(ings: list[Ingredient], grams: list[float]) -> None:
    """Увеличение массы любого ингредиента не уменьшает суммарную калорийность."""
    n = min(len(ings), len(grams))
    ings, grams = ings[:n], grams[:n]
    items = list(zip(ings, grams, strict=True))
    base = verify(items)

    bumped_items = [(ing, g + 5.0) for ing, g in items]
    bumped = verify(bumped_items)

    assert bumped.kcal >= base.kcal - 1e-9


@given(ings=ingredients(min_size=1, max_size=5), grams=st.lists(_grams, min_size=5, max_size=5))
def test_item_contributions_sum_to_totals(ings: list[Ingredient], grams: list[float]) -> None:
    """Сумма вкладов позиций равна итогам блюда — итоги и есть эта сумма."""
    items = list(zip(ings, grams[: len(ings)], strict=True))
    dish = verify(items)

    assert len(dish.items) == len(items)
    for item, (ing, g) in zip(dish.items, items, strict=True):
        assert item.ingredient is ing
        assert item.grams == g
    for field in ("kcal", "fat_g", "protein_g", "carbs_g", "fiber_g"):
        total = sum(getattr(item, field) for item in dish.items)
        assert total == pytest.approx(getattr(dish, field), rel=1e-9, abs=1e-9)


@given(ings=ingredients(min_size=1, max_size=4))
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
# Потолок остаётся только здесь: каждый пример решает задачу линейного
# программирования, и глубокий перебор сделал бы задачу ядра в CI минутной.
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


@given(
    fat=st.floats(min_value=50.0, max_value=100.0, allow_nan=False),
    protein=st.floats(min_value=0.0, max_value=30.0, allow_nan=False),
    carbs=st.floats(min_value=0.0, max_value=20.0, allow_nan=False),
    ratio=st.sampled_from([2.0, 2.5, 3.0, 3.5, 4.0]),
    kcal_target=st.floats(min_value=200.0, max_value=1200.0, allow_nan=False),
    protein_goal=st.floats(min_value=0.0, max_value=60.0, allow_nan=False),
    carbs_goal=st.floats(min_value=0.0, max_value=60.0, allow_nan=False),
    entered=st.lists(_grams, min_size=3, max_size=3),
)
@settings(max_examples=60)
def test_meal_goals_and_entered_masses_never_cost_the_tolerances(
    fat: float,
    protein: float,
    carbs: float,
    ratio: float,
    kcal_target: float,
    protein_goal: float,
    carbs_goal: float,
    entered: list[float],
) -> None:
    """The split of the meal and the entered masses are preferences: whatever
    they are, a solved dish holds the ratio and the calories (ADR-0083)."""
    products = [
        Ingredient("fat_source", kcal=fat * 9, fat=fat, protein=0.0, carbs=0.0),
        Ingredient(
            "lean_source", kcal=(protein + 1.0) * 4, fat=0.0, protein=protein + 1.0, carbs=0.0
        ),
        Ingredient("carb_source", kcal=(carbs + 1.0) * 4, fat=0.0, protein=0.0, carbs=carbs + 1.0),
    ]
    targets = Targets(
        ratio=ratio,
        kcal=kcal_target,
        protein_g=protein_goal,
        net_carbs_g=carbs_goal,
        near_grams={
            product.product_id: grams for product, grams in zip(products, entered, strict=True)
        },
    )

    try:
        result = solve(products, targets)
    except InfeasibleError:
        return

    dish = verify([(item.ingredient, item.grams) for item in result.dish.items])
    assert dish.ratio is not None
    assert abs(dish.ratio - ratio) <= RATIO_TOLERANCE
    assert abs(dish.kcal - kcal_target) <= kcal_target * KCAL_TOLERANCE_FRACTION
    assert result.macro_fit is not None


_CATALOGUE = [
    Ingredient("butter", 0.0, 82.5, 0.5, 0.8),
    Ingredient("oil", 0.0, 99.9, 0.0, 0.0),
    Ingredient("cream", 0.0, 33.0, 2.2, 3.0),
    Ingredient("chicken", 0.0, 1.9, 23.6, 0.4),
    Ingredient("egg", 0.0, 11.5, 12.7, 0.7),
    Ingredient("liver", 0.0, 3.7, 17.9, 5.3),
    Ingredient("cucumber", 0.0, 0.1, 0.8, 2.5, 1.0),
    Ingredient("broccoli", 0.0, 0.4, 2.8, 6.6, 2.6),
    Ingredient("avocado", 0.0, 14.7, 2.0, 8.5, 6.7),
    Ingredient("cheese", 0.0, 29.0, 23.0, 0.3),
    Ingredient("apple", 0.0, 0.4, 0.4, 9.8, 1.8),
    Ingredient("salmon", 0.0, 15.0, 20.0, 0.0),
]

_dish = st.lists(
    st.sampled_from(_CATALOGUE), min_size=2, max_size=6, unique_by=lambda i: i.product_id
)
_ratio = st.sampled_from([2.0, 2.5, 3.0, 3.5, 4.0])
_meal_kcal = st.sampled_from([80.0, 120.0, 180.0, 250.0, 320.0, 450.0])


def _grams_of(result) -> dict[str, float]:
    return {item.ingredient.product_id: item.grams for item in result.dish.items}


@given(products=_dish, ratio=_ratio, kcal=_meal_kcal, with_split=st.booleans())
@settings(max_examples=60)
def test_solving_ones_own_answer_changes_nothing(
    products: list[Ingredient], ratio: float, kcal: float, with_split: bool
) -> None:
    """An answer that is on target is a fixed point: the entered dish is only
    polished, and the answer is already polished (audit of 2026-11-15, A2)."""
    bounds = {product.product_id: (2.0, 5000.0) for product in products}
    goal = max_non_fat_grams(ratio, kcal)
    targets = Targets(
        ratio=ratio,
        kcal=kcal,
        per_ingredient_bounds=bounds,
        protein_g=goal * 0.5 if with_split else None,
        net_carbs_g=goal * 0.5 if with_split else None,
    )
    try:
        first = solve(products, targets)
    except InfeasibleError:
        return
    again = refine([(item.ingredient, item.grams) for item in first.dish.items], targets)
    on_target = (
        first.ratio_within_tolerance
        and first.kcal_within_tolerance
        and (first.macro_fit is None or first.macro_fit.within_tolerance)
    )
    if not on_target:
        assert again is None
        return
    assert again is not None
    assert _grams_of(again) == _grams_of(first)


@given(products=_dish, ratio=_ratio, kcal=_meal_kcal, seed=st.randoms(use_true_random=False))
@settings(max_examples=60)
def test_answer_does_not_depend_on_the_order_of_products(
    products: list[Ingredient], ratio: float, kcal: float, seed
) -> None:
    shuffled = list(products)
    seed.shuffle(shuffled)
    targets = Targets(ratio=ratio, kcal=kcal)
    try:
        first = solve(products, targets)
    except InfeasibleError:
        with pytest.raises(InfeasibleError):
            solve(shuffled, targets)
        return
    assert _grams_of(solve(shuffled, targets)) == _grams_of(first)


@given(
    free=st.lists(
        st.sampled_from(_CATALOGUE), min_size=2, max_size=2, unique_by=lambda i: i.product_id
    ),
    pinned=st.sampled_from(_CATALOGUE),
    pinned_grams=st.integers(min_value=2, max_value=80),
    ratio=_ratio,
    kcal=_meal_kcal,
)
@settings(max_examples=80)
def test_a_dish_on_target_beside_a_pin_is_found(
    free: list[Ingredient], pinned: Ingredient, pinned_grams: int, ratio: float, kcal: float
) -> None:
    """If whole grams of the two free products put the dish inside both
    tolerances with the third product pinned, the solver does not refuse and
    does not hand back a dish outside them (audit of 2026-11-15, A1). The
    witness is found by brute force, independently of the solver."""
    if any(product.product_id == pinned.product_id for product in free):
        return
    first, second = free
    grid = np.arange(2.0, 201.0)
    a, b = np.meshgrid(grid, grid, indexing="ij")

    def total(field: str) -> np.ndarray:
        def per_gram(product: Ingredient) -> float:
            if field == "net":
                return max(product.carbs - product.fiber, 0.0) / 100.0
            return getattr(product, field) / 100.0

        return a * per_gram(first) + b * per_gram(second) + pinned_grams * per_gram(pinned)

    fat, protein, carbs, net = total("fat"), total("protein"), total("carbs"), total("net")
    denominator = protein + net
    with np.errstate(divide="ignore", invalid="ignore"):
        dish_ratio = np.where(denominator > 1e-6, fat / denominator, np.inf)
    dish_kcal = 9 * fat + 4 * protein + 4 * carbs
    # A margin inside the tolerances: a witness on their very edge is a matter
    # of the last bit of a float, not of the solver.
    witness = (np.abs(dish_ratio - ratio) <= RATIO_TOLERANCE * 0.9) & (
        np.abs(dish_kcal - kcal) <= kcal * KCAL_TOLERANCE_FRACTION * 0.9
    )
    if not witness.any():
        return

    targets = Targets(
        ratio=ratio,
        kcal=kcal,
        per_ingredient_bounds={
            first.product_id: (2.0, 200.0),
            second.product_id: (2.0, 200.0),
            pinned.product_id: (float(pinned_grams), float(pinned_grams)),
        },
    )
    result = solve([first, second, pinned], targets)
    assert _grams_of(result)[pinned.product_id] == pinned_grams
    assert result.ratio_within_tolerance and result.kcal_within_tolerance


@given(ings=ingredients(min_size=1, max_size=5), grams=st.lists(_grams, min_size=5, max_size=5))
def test_search_totals_are_the_totals_of_verify(ings: list[Ingredient], grams: list[float]) -> None:
    """The solver weighs candidates with a lighter sum than `verify()`; the two
    must agree to the bit, or the search would rank dishes by numbers the
    result never shows."""
    items = list(zip(ings, grams[: len(ings)], strict=True))
    full, light = verify(items), _totals(items)
    for field in ("kcal", "fat_g", "protein_g", "carbs_g", "fiber_g", "net_carbs_g", "ratio"):
        assert getattr(light, field) == getattr(full, field)
