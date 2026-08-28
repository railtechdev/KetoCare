"""Точечные тесты внутренних веток движка (защитные случаи диагностики
неразрешимости, раздел 6.3 ТЗ), не покрытые эталонами/property-тестами."""

from __future__ import annotations

import pytest

from keto_engine import (
    InfeasibleError,
    Ingredient,
    Targets,
    max_non_fat_grams,
    scale,
    solve,
    verify,
)
from keto_engine.constants import RATIO_TOLERANCE
from keto_engine.engine import (
    _candidate_is_valid,
    _diagnose_infeasibility,
    _max_achievable_kcal,
    _repair_rounding,
)


def test_scale_rejects_non_positive_factor() -> None:
    dish = verify([(Ingredient("a", kcal=100, fat=10.0, protein=5.0, carbs=5.0), 50.0)])
    with pytest.raises(ValueError):
        scale(dish, 0.0)
    with pytest.raises(ValueError):
        scale(dish, -1.0)


def test_max_achievable_kcal_unbounded_without_upper_bound() -> None:
    """Ингредиент, чьё собственное соотношение точно равно целевому: любая его масса
    удовлетворяет равенству, а без верхней границы задача максимизации kcal неограничена."""
    perfect = Ingredient("perfect", kcal=400, fat=40.0, protein=10.0, carbs=0.0, fiber=0.0)
    targets = Targets(ratio=4.0, kcal=1000, per_ingredient_bounds={"perfect": (0.0, None)})
    assert _max_achievable_kcal([perfect], targets) == float("inf")


def test_max_achievable_kcal_zero_when_only_trivial_solution() -> None:
    a = Ingredient("a", kcal=100, fat=0.0, protein=20.0, carbs=5.0, fiber=0.0)
    b = Ingredient("b", kcal=100, fat=0.0, protein=2.0, carbs=20.0, fiber=1.0)
    targets = Targets(ratio=4.0, kcal=400)
    assert _max_achievable_kcal([a, b], targets) == pytest.approx(0.0, abs=1e-9)


def test_max_achievable_kcal_returns_zero_when_relaxed_lp_itself_infeasible() -> None:
    """Принудительные нижняя/верхняя границы масс несовместимы с равенством
    соотношения даже без учёта коридора калорийности — сама LP неразрешима."""
    a = Ingredient("a", kcal=100, fat=0.0, protein=20.0, carbs=0.0, fiber=0.0)
    b = Ingredient("b", kcal=100, fat=40.0, protein=0.0, carbs=0.0, fiber=0.0)
    targets = Targets(
        ratio=1.0,
        kcal=400,
        per_ingredient_bounds={"a": (10.0, 20.0), "b": (0.0, 1.0)},
    )
    assert _max_achievable_kcal([a, b], targets) == 0.0


def test_diagnose_infeasibility_generic_corridor_fallback_message() -> None:
    """Соотношение достижимо (и весьма щедро), белок/углеводы/границы не заданы,
    но сама калорийность недостижима даже на верхней границе массы ингредиента —
    ни одна из специфичных причин не подходит, должно вернуться общее сообщение."""
    perfect = Ingredient("perfect", kcal=400, fat=40.0, protein=10.0, carbs=0.0, fiber=0.0)
    targets = Targets(ratio=4.0, kcal=25000)
    reason = _diagnose_infeasibility([perfect], targets)
    assert "измените набор продуктов, границы масс или ослабьте цель" in reason


class TestMaxNonFatGrams:
    """Предел суммы белков и углеводов, следующий из определения соотношения.

    Проверяется не пересказом формулы, а согласованностью с остальным ядром:
    блюдо, сложенное ровно по этому пределу, должно давать заданные ratio и kcal,
    а требование сверх предела — делать задачу неразрешимой для solve().
    """

    @pytest.mark.parametrize(
        "ratio,kcal",
        [(4.0, 1200), (3.0, 1200), (2.5, 800), (2.0, 1500), (4.5, 1000)],
    )
    def test_dish_built_at_the_limit_matches_ratio_and_kcal(
        self, ratio: float, kcal: float
    ) -> None:
        non_fat = max_non_fat_grams(ratio, kcal)
        fat = ratio * non_fat  # из F = R·(P+C)

        protein_source = Ingredient("p", kcal=400, fat=0.0, protein=100.0, carbs=0.0)
        fat_source = Ingredient("f", kcal=900, fat=100.0, protein=0.0, carbs=0.0)

        dish = verify([(protein_source, non_fat), (fat_source, fat)])

        assert dish.ratio == pytest.approx(ratio)
        assert dish.kcal == pytest.approx(kcal)

    def test_protein_above_limit_makes_solve_infeasible(self) -> None:
        """Цель по белку выше предела невыполнима ни при каком наборе продуктов."""
        ratio, kcal = 4.0, 1000.0
        limit = max_non_fat_grams(ratio, kcal)

        ingredients = [
            Ingredient("fat", kcal=900, fat=100.0, protein=0.0, carbs=0.0),
            Ingredient("protein", kcal=400, fat=0.0, protein=100.0, carbs=0.0),
        ]

        feasible = solve(ingredients, Targets(ratio=ratio, kcal=kcal, protein_min_g=limit * 0.5))
        assert feasible.dish.protein_g >= limit * 0.5 - 1

        with pytest.raises(InfeasibleError):
            solve(ingredients, Targets(ratio=ratio, kcal=kcal, protein_min_g=limit * 1.5))

    def test_limit_shrinks_as_ratio_rises(self) -> None:
        """Чем выше кетосоотношение, тем меньше места для белка и углеводов."""
        limits = [max_non_fat_grams(r, 1200) for r in (2.0, 3.0, 4.0, 5.0)]
        assert limits == sorted(limits, reverse=True)

    @pytest.mark.parametrize("ratio,kcal", [(0, 1000), (-1, 1000), (4.0, 0), (4.0, -5)])
    def test_non_positive_arguments_rejected(self, ratio: float, kcal: float) -> None:
        with pytest.raises(ValueError):
            max_non_fat_grams(ratio, kcal)


class TestRoundingRepair:
    """Округление масс до грамма не должно выводить соотношение за допуск.

    Раздел 6.4 ТЗ требует, чтобы `verify(solve(x))` всегда был в допусках. LP
    решает задачу точно, но округление результата ломало это на небольших
    приёмах пищи — случай ниже найден property-тестом.
    """

    def test_small_meal_stays_within_tolerance(self) -> None:
        fat_source = Ingredient("fat", kcal=86 * 9, fat=86.0, protein=0.0, carbs=0.0)
        lean_source = Ingredient("lean", kcal=117.0, fat=0.0, protein=10.75, carbs=19.5)
        targets = Targets(ratio=4.0, kcal=200.0)

        result = solve([fat_source, lean_source], targets)

        # Наивное округление точного решения (23.26 / 16.53) дало бы 23/17 г
        # и соотношение 3.85 — мимо допуска ±0.15.
        assert result.ratio_within_tolerance
        assert result.kcal_within_tolerance

        dish = verify([(item.ingredient, item.grams) for item in result.dish.items])
        assert dish.ratio is not None
        assert abs(dish.ratio - targets.ratio) <= RATIO_TOLERANCE

    def test_repair_keeps_masses_whole_grams(self) -> None:
        """Починка не должна возвращать дробные массы: их нельзя отмерить."""
        fat_source = Ingredient("fat", kcal=86 * 9, fat=86.0, protein=0.0, carbs=0.0)
        lean_source = Ingredient("lean", kcal=117.0, fat=0.0, protein=10.75, carbs=19.5)

        result = solve([fat_source, lean_source], Targets(ratio=4.0, kcal=200.0))
        for item in result.dish.items:
            assert item.grams == pytest.approx(round(item.grams))

    def test_repair_respects_ingredient_bounds(self) -> None:
        """Подбор рядом с решением не имеет права выйти за заданные границы масс."""
        fat_source = Ingredient("fat", kcal=86 * 9, fat=86.0, protein=0.0, carbs=0.0)
        lean_source = Ingredient("lean", kcal=117.0, fat=0.0, protein=10.75, carbs=19.5)
        targets = Targets(ratio=4.0, kcal=200.0, per_ingredient_bounds={"fat": (0.0, 23.0)})

        result = solve([fat_source, lean_source], targets)
        used = {item.ingredient.product_id: item.grams for item in result.dish.items}
        assert used.get("fat", 0.0) <= 23.0


class TestRepairInternals:
    """Ветки починки округления, недостижимые через обычный solve()."""

    FAT = Ingredient("fat", kcal=86 * 9, fat=86.0, protein=0.0, carbs=0.0)
    LEAN = Ingredient("lean", kcal=117.0, fat=0.0, protein=10.75, carbs=19.5)

    def test_candidate_rejected_below_lower_bound(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, per_ingredient_bounds={"fat": (30.0, 60.0)})
        assert not _candidate_is_valid([10.0, 16.0], [self.FAT, self.LEAN], targets)

    def test_candidate_rejected_above_upper_bound(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, per_ingredient_bounds={"fat": (0.0, 20.0)})
        assert not _candidate_is_valid([25.0, 16.0], [self.FAT, self.LEAN], targets)

    def test_candidate_rejected_when_all_masses_negligible(self) -> None:
        """Массы ниже минимальной реалистичной дают пустое блюдо."""
        targets = Targets(ratio=4.0, kcal=200.0)
        assert not _candidate_is_valid([0.0, 0.0], [self.FAT, self.LEAN], targets)

    def test_candidate_rejected_outside_kcal_corridor(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0)
        assert not _candidate_is_valid([100.0, 60.0], [self.FAT, self.LEAN], targets)

    def test_candidate_rejected_below_protein_minimum(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, protein_min_g=50.0)
        assert not _candidate_is_valid([23.0, 16.0], [self.FAT, self.LEAN], targets)

    def test_candidate_rejected_above_carbs_limit(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, carbs_max_g=0.5)
        assert not _candidate_is_valid([23.0, 16.0], [self.FAT, self.LEAN], targets)

    def test_repair_returns_input_when_nothing_can_move_ratio(self) -> None:
        """У продукта, чьё собственное соотношение равно целевому, сдвиг массы
        не меняет R — двигать нечего, возвращается исходное решение."""
        neutral = Ingredient("neutral", kcal=0.0, fat=40.0, protein=10.0, carbs=0.0)
        base = [10.0]
        assert _repair_rounding(base, [neutral], Targets(ratio=4.0, kcal=200.0)) == base

    def test_repair_returns_best_effort_when_tolerance_unreachable(self) -> None:
        """Если в допуск не попадает ни один кандидат, возвращается ближайший,
        а не исходный: показать «почти верное» лучше, чем заведомо худшее."""
        targets = Targets(ratio=4.0, kcal=200.0)
        repaired = _repair_rounding([23.0, 17.0], [self.FAT, self.LEAN], targets)
        assert repaired != [23.0, 17.0]

    def test_repair_skips_candidates_without_defined_ratio(self) -> None:
        """Кандидат из одних жиров даёт ratio=None (нет белков и углеводов) и
        должен пропускаться, а не ронять подбор."""
        pure_fat = Ingredient("pure_fat", kcal=900.0, fat=100.0, protein=0.0, carbs=0.0)
        targets = Targets(ratio=4.0, kcal=200.0)
        result = _repair_rounding([22.0, 2.0], [pure_fat, self.LEAN], targets)
        assert isinstance(result, list)
