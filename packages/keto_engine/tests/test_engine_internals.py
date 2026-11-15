"""Точечные тесты внутренних веток движка (защитные случаи диагностики
неразрешимости, раздел 6.3 ТЗ), не покрытые эталонами/property-тестами."""

from __future__ import annotations

import pytest
from scipy.optimize import OptimizeResult

from keto_engine import (
    ENGINE_VERSION,
    InfeasibleError,
    Ingredient,
    MealMacroGoal,
    SolveResult,
    Targets,
    macro_fit,
    max_non_fat_grams,
    meal_kcal,
    meal_macro_goal,
    refine,
    scale,
    solve,
    verify,
    within_tolerance,
)
from keto_engine import engine as engine_module
from keto_engine.constants import (
    GRAM_ROUNDING,
    KCAL_TOLERANCE_FRACTION,
    MEAL_MACRO_TOLERANCE_G,
    MIN_INGREDIENT_GRAMS,
    RATIO_TOLERANCE,
)
from keto_engine.engine import (
    _better,
    _candidate_rank,
    _closest_whole_grams,
    _diagnose_infeasibility,
    _max_achievable_kcal,
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


class TestRoundingKeepsHardBounds:
    """Минимум белка и лимит углеводов держатся и после округления до грамма.

    Аудит расчётов 13.11.2026: починка округления запускалась только по
    соотношению, и подбор молча отдавал блюдо с белком ниже цели или
    углеводами выше лимита на 0,1–0,2 г. Случаи найдены перебором на
    продуктах USDA.
    """

    COTTAGE = Ingredient("cottage", kcal=0.0, fat=9.0, protein=16.0, carbs=2.0)
    MAYO = Ingredient("mayo", kcal=0.0, fat=75.0, protein=1.0, carbs=0.6)
    BROCCOLI = Ingredient("broccoli", kcal=0.0, fat=0.4, protein=2.8, carbs=6.6, fiber=2.6)
    AVOCADO = Ingredient("avocado", kcal=0.0, fat=14.7, protein=2.0, carbs=8.5, fiber=6.7)
    MACADAMIA = Ingredient("macadamia", kcal=0.0, fat=76.0, protein=7.8, carbs=13.4, fiber=8.0)
    CUCUMBER = Ingredient("cucumber", kcal=0.0, fat=0.1, protein=0.7, carbs=3.6, fiber=0.5)
    APPLE = Ingredient("apple", kcal=0.0, fat=0.2, protein=0.3, carbs=13.8, fiber=2.4)

    def test_protein_minimum_repaired_after_rounding(self) -> None:
        # Before 1.8.0: 31/22/7 g gave 5.38 g protein against a 5.4 g minimum.
        targets = Targets(ratio=3.0, kcal=200.0, protein_min_g=5.4)
        result = solve([self.COTTAGE, self.MAYO, self.BROCCOLI], targets)
        assert result.dish.protein_g >= 5.4
        assert result.ratio_within_tolerance and result.kcal_within_tolerance

    def test_carbs_limit_kept_or_refused(self) -> None:
        # No whole-gram dish of these three holds 0.9 g of carbs at 30 kcal: a
        # refusal with the reason, not a dish over the limit handed back.
        targets = Targets(ratio=3.0, kcal=30.0, carbs_max_g=0.9)
        with pytest.raises(InfeasibleError, match="лимите 0.9 г"):
            solve([self.CUCUMBER, self.APPLE, self.MACADAMIA], targets)

    def test_protein_minimum_kept_or_refused(self) -> None:
        targets = Targets(ratio=1.0, kcal=20.0, protein_min_g=0.4)
        with pytest.raises(InfeasibleError, match="белок 0.4 г"):
            solve([self.MACADAMIA, self.CUCUMBER], targets)

    def test_wider_search_finds_the_dish_that_used_to_be_refused(self) -> None:
        """A refusal until 1.10.0: the dish that keeps the protein minimum lay
        further than one gram at a time could reach."""
        result = solve(
            [self.MAYO, self.CUCUMBER, self.MACADAMIA],
            Targets(ratio=1.0, kcal=200.0, protein_min_g=4.0),
        )
        assert result.dish.protein_g >= 4.0
        assert result.ratio_within_tolerance and result.kcal_within_tolerance

    def test_limit_is_kept_before_the_ratio_and_the_verdict_says_so(self) -> None:
        """No whole-gram dish of these three is inside both the carbs limit and
        the ratio's tolerance. The limit is a bound and the tolerance is a
        verdict: the dish keeps the limit and is honestly marked off the ratio,
        so the person can see what the products give. Until 1.10.0 the search
        chased the ratio first and the answer was a refusal."""
        result = solve(
            [self.AVOCADO, self.MACADAMIA, self.COTTAGE],
            Targets(ratio=3.0, kcal=300.0, carbs_max_g=4.8),
        )
        assert result.dish.carbs_g <= 4.8
        assert result.kcal_within_tolerance is True
        assert result.ratio_within_tolerance is False

    def test_descent_finds_the_dish_the_four_product_search_refused(self) -> None:
        """Until 1.10.0 a refusal: the whole-gram search moved the products that
        steer the ratio, and the gram that kept the protein lay with another."""
        targets = Targets(ratio=2.0, kcal=300.0, protein_min_g=4.4)
        result = solve([self.MACADAMIA, self.CUCUMBER], targets)
        assert result.dish.protein_g >= 4.4
        assert result.ratio_within_tolerance and result.kcal_within_tolerance

    def test_room_for_rounding_finds_the_dish_that_used_to_be_refused(self) -> None:
        """Until 1.9.0 this was a refusal: the exact solution sat on the protein
        minimum and rounding fell under it. Kept half a gram away from the
        minimum, the solution rounds to a dish that holds it."""
        targets = Targets(ratio=2.0, kcal=100.0, protein_min_g=1.4)
        result = solve([self.CUCUMBER, self.MACADAMIA, self.APPLE], targets)
        assert result.dish.protein_g >= 1.4
        assert result.ratio_within_tolerance and result.kcal_within_tolerance


class TestRepairInternals:
    """Ветки починки округления, недостижимые через обычный solve()."""

    FAT = Ingredient("fat", kcal=86 * 9, fat=86.0, protein=0.0, carbs=0.0)
    LEAN = Ingredient("lean", kcal=117.0, fat=0.0, protein=10.75, carbs=19.5)

    def test_candidate_rejected_below_lower_bound(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, per_ingredient_bounds={"fat": (30.0, 60.0)})
        assert _candidate_rank([10.0, 16.0], [self.FAT, self.LEAN], targets) is None

    def test_candidate_rejected_above_upper_bound(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, per_ingredient_bounds={"fat": (0.0, 20.0)})
        assert _candidate_rank([25.0, 16.0], [self.FAT, self.LEAN], targets) is None

    def test_candidate_rejected_when_all_masses_negligible(self) -> None:
        """Массы ниже минимальной реалистичной дают пустое блюдо."""
        targets = Targets(ratio=4.0, kcal=200.0)
        assert _candidate_rank([0.0, 0.0], [self.FAT, self.LEAN], targets) is None

    def _broken(self, grams: list[float], targets: Targets) -> bool:
        rank = _candidate_rank(grams, [self.FAT, self.LEAN], targets)
        assert rank is not None
        return rank[0]

    def test_a_broken_limit_ranks_below_every_dish_that_keeps_them(self) -> None:
        """A composition outside the calorie corridor, under the protein minimum
        or over the carbs limit still has a rank, so that the search can walk
        away from it, and that rank is worse than any dish that keeps the limits."""
        assert self._broken([100.0, 60.0], Targets(ratio=4.0, kcal=200.0))
        assert self._broken([23.0, 16.0], Targets(ratio=4.0, kcal=200.0, protein_min_g=50.0))
        assert self._broken([23.0, 16.0], Targets(ratio=4.0, kcal=200.0, carbs_max_g=0.5))
        assert not self._broken([24.0, 17.0], Targets(ratio=4.0, kcal=200.0))

    def test_both_sides_of_the_calorie_corridor_are_a_broken_limit(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0)
        assert self._broken([12.0, 8.0], targets)
        assert self._broken([36.0, 25.0], targets)

    def test_search_walks_from_a_broken_limit_to_a_dish(self) -> None:
        """Two grams short of the calorie corridor: the gram-by-gram descent
        reaches a dish inside it instead of handing the input back."""
        targets = Targets(ratio=4.0, kcal=200.0)
        found = _closest_whole_grams([20.0, 14.0], [self.FAT, self.LEAN], targets)
        assert not self._broken(found, targets)

    def test_product_on_the_target_ratio_is_moved_for_calories_only(self) -> None:
        """A product whose own ratio is the target cannot move the ratio; the
        descent still brings its calories to the goal."""
        neutral = Ingredient("neutral", kcal=0.0, fat=40.0, protein=10.0, carbs=0.0)
        found = _closest_whole_grams([10.0], [neutral], Targets(ratio=4.0, kcal=200.0))
        assert found == [50.0]

    def test_pinned_product_is_never_moved_by_the_search(self) -> None:
        targets = Targets(ratio=4.0, kcal=200.0, per_ingredient_bounds={"fat": (23.0, 23.0)})
        found = _closest_whole_grams([23.0, 17.0], [self.FAT, self.LEAN], targets)
        assert found[0] == 23.0

    def test_repair_returns_best_effort_when_tolerance_unreachable(self) -> None:
        """Если в допуск не попадает ни один кандидат, возвращается ближайший,
        а не исходный: показать «почти верное» лучше, чем заведомо худшее."""
        targets = Targets(ratio=4.0, kcal=200.0)
        repaired = _closest_whole_grams([23.0, 17.0], [self.FAT, self.LEAN], targets)
        assert repaired != [23.0, 17.0]

    def test_candidate_without_a_ratio_is_not_ranked(self) -> None:
        pure_fat = Ingredient("pure_fat", kcal=900.0, fat=100.0, protein=0.0, carbs=0.0)
        assert _candidate_rank([22.0], [pure_fat], Targets(ratio=4.0, kcal=198.0)) is None

    def test_ratio_inside_tolerance_outranks_any_ratio_outside(self) -> None:
        """A dish exact on calories with the ratio past its tolerance loses to
        one whose calories are worse and whose ratio is inside."""
        targets = Targets(ratio=4.0, kcal=200.0)
        ingredients = [self.FAT, self.LEAN]
        outside = _candidate_rank([23.0, 17.0], ingredients, targets)
        inside = _candidate_rank([24.0, 17.0], ingredients, targets)
        assert outside is not None and inside is not None
        assert outside[1] and not inside[1]
        assert inside < outside

    def test_search_returns_the_closest_dish_not_the_first_allowed(self) -> None:
        """Every whole-gram neighbour is weighed: nothing in reach is closer
        to the ratio and the calories than what comes back."""
        targets = Targets(ratio=4.0, kcal=200.0)
        ingredients = [self.FAT, self.LEAN]
        chosen = _closest_whole_grams([23.0, 17.0], ingredients, targets)
        chosen_rank = _candidate_rank(chosen, ingredients, targets)
        assert chosen_rank is not None
        for fat in range(21, 26):
            for lean in range(15, 20):
                rank = _candidate_rank([float(fat), float(lean)], ingredients, targets)
                assert rank is None or chosen_rank <= rank

    def test_repair_skips_candidates_without_defined_ratio(self) -> None:
        """Кандидат из одних жиров даёт ratio=None (нет белков и углеводов) и
        должен пропускаться, а не ронять подбор."""
        pure_fat = Ingredient("pure_fat", kcal=900.0, fat=100.0, protein=0.0, carbs=0.0)
        targets = Targets(ratio=4.0, kcal=200.0)
        result = _closest_whole_grams([22.0, 2.0], [pure_fat, self.LEAN], targets)
        assert isinstance(result, list)


class TestItemContributions:
    """Вклад каждой позиции в показатели блюда (ENGINE_VERSION 0.4.0).

    Строка состава в калькуляторе показывает, что именно даёт каждый продукт;
    считать это в браузере нельзя (второй источник клинических чисел), поэтому
    вклад отдаёт ядро — и обязан сходиться с итогом блюда.
    """

    def test_contribution_is_mass_share_of_per_100g(self) -> None:
        butter = Ingredient(product_id="butter", kcal=717, fat=81.0, protein=0.5, carbs=1.0)
        egg = Ingredient(product_id="egg", kcal=155, fat=11.0, protein=13.0, carbs=1.0, fiber=0.0)

        dish = verify([(butter, 50.0), (egg, 100.0)])

        first, second = dish.items
        assert first.ingredient is butter
        assert first.grams == 50.0
        assert first.fat_g == pytest.approx(40.5)
        assert first.protein_g == pytest.approx(0.25)
        assert first.carbs_g == pytest.approx(0.5)
        assert first.fiber_g == 0.0
        # 40.5 × 9 + 0.25 × 4 + 0.5 × 4
        assert first.kcal == pytest.approx(367.5)

        assert second.ingredient is egg
        assert second.fat_g == pytest.approx(11.0)
        assert second.protein_g == pytest.approx(13.0)
        assert second.carbs_g == pytest.approx(1.0)
        assert second.kcal == pytest.approx(155.0)

    def test_contributions_sum_to_dish_totals(self) -> None:
        cream = Ingredient(
            product_id="cream", kcal=340, fat=35.0, protein=2.5, carbs=3.0, fiber=0.0
        )
        avocado = Ingredient(
            product_id="avocado", kcal=160, fat=15.0, protein=2.0, carbs=9.0, fiber=7.0
        )

        dish = verify([(cream, 80.0), (avocado, 60.0)])

        assert sum(item.fat_g for item in dish.items) == pytest.approx(dish.fat_g)
        assert sum(item.protein_g for item in dish.items) == pytest.approx(dish.protein_g)
        assert sum(item.carbs_g for item in dish.items) == pytest.approx(dish.carbs_g)
        assert sum(item.fiber_g for item in dish.items) == pytest.approx(dish.fiber_g)
        assert sum(item.kcal for item in dish.items) == pytest.approx(dish.kcal)

    def test_zero_mass_contributes_nothing(self) -> None:
        oil = Ingredient(product_id="oil", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        dish = verify([(oil, 0.0)])
        (item,) = dish.items
        assert (item.kcal, item.fat_g, item.protein_g, item.carbs_g, item.fiber_g) == (
            0,
            0,
            0,
            0,
            0,
        )
        assert dish.ratio is None


class TestNetCarbsRatio:
    """Соотношение считается по чистым углеводам, лимит — по общим.

    Ответ клиники от 09.09.2026 (вопросы 2, 3 и 6 в `OPEN_QUESTIONS.md`):
    «считать „чистые“ углеводы, с вычетом клетчатки», «клетчатка… не входит в
    чистые углеводы», но «лимит… учитываются все углеводы».
    """

    def test_fibre_leaves_the_ratio_denominator(self) -> None:
        # Продукт из одной клетчатки: знаменателя он не даёт вовсе.
        fat = Ingredient(product_id="oil", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        husk = Ingredient(product_id="husk", kcal=0, fat=0.0, protein=0.0, carbs=10.0, fiber=10.0)

        dish = verify([(fat, 10.0), (husk, 100.0)])

        assert dish.carbs_g == pytest.approx(10.0)
        assert dish.net_carbs_g == pytest.approx(0.0)
        # 10 г жира на нулевой знаменатель — соотношения нет, а не бесконечность.
        assert dish.ratio is None

    def test_ratio_uses_net_carbs(self) -> None:
        avocado = Ingredient(
            product_id="avocado", kcal=160, fat=14.7, protein=2.0, carbs=8.5, fiber=6.7
        )

        dish = verify([(avocado, 100.0)])

        # 14.7 / (2.0 + (8.5 − 6.7)) = 3.868…, а по общим углеводам было бы 1.4.
        assert dish.net_carbs_g == pytest.approx(1.8)
        assert dish.ratio == pytest.approx(14.7 / 3.8)

    def test_fibre_over_carbs_does_not_go_negative(self) -> None:
        # Импорт такой продукт отвергает, но ядро на чужую проверку не полагается:
        # отрицательный вклад завысил бы соотношение всего блюда.
        odd = Ingredient(product_id="odd", kcal=0, fat=10.0, protein=1.0, carbs=1.0, fiber=5.0)

        dish = verify([(odd, 100.0)])

        assert dish.net_carbs_g == pytest.approx(0.0)
        assert dish.ratio == pytest.approx(10.0 / 1.0)

    def test_fibre_is_subtracted_per_product_not_per_dish(self) -> None:
        """Зажим стоит у КАЖДОГО продукта, а не у итога блюда.

        Случай смешанный намеренно: на блюде из одного продукта оба способа
        совпадают, и прежний тест не отличал их. Здесь у первого продукта
        клетчатки больше углеводов (−4 г), у второго — меньше (+4 г).

        По продуктам: 0 + 4 = 4 г чистых, соотношение 10 / (1 + 4) = 2.
        По блюду целиком: 7.6 − 7.6 = 0 г, соотношение 10 / 1 = 10.

        Разница впятеро. Зажим у итога позволил бы клетчатке одного продукта
        гасить углеводы другого — то есть соотношение блюда стало бы зависеть
        от того, чем его дополнили.
        """
        odd = Ingredient(product_id="odd", kcal=0, fat=10.0, protein=1.0, carbs=1.0, fiber=5.0)
        veg = Ingredient(product_id="veg", kcal=34, fat=0.0, protein=0.0, carbs=6.6, fiber=2.6)

        dish = verify([(odd, 100.0), (veg, 100.0)])

        assert dish.carbs_g == pytest.approx(7.6)
        assert dish.fiber_g == pytest.approx(7.6)
        # Зажим по блюду дал бы здесь ноль — и соотношение 10.0.
        assert dish.net_carbs_g == pytest.approx(4.0)
        assert dish.ratio == pytest.approx(10.0 / 5.0)

    def test_solver_clamps_fibre_per_product_too(self) -> None:
        """Тот же зажим стоит и в решателе — иначе он промахивается мимо цели.

        `odd` — продукт, у которого клетчатки больше углеводов. Без зажима его
        вклад в знаменатель ОТРИЦАТЕЛЕН, и решатель считает, что этот продукт
        гасит углеводы соседей. Он строит равенство на знаменателе, которого у
        готового блюда нет, и добирает овоща сверх нужного.

        Границы держат `odd` в составе принудительно: без них решатель обходится
        маслом, оба правила дают один ответ, и случай ничего не различает —
        именно так первая версия этого теста и прошла на мутанте.

        Мера расхождения: с зажимом подбор даёт ровно 3,0; без него — 2,39 и
        вердикт «не в допуске» на им же подобранном составе.
        """
        oil = Ingredient(product_id="oil", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        odd = Ingredient(product_id="odd", kcal=50, fat=1.0, protein=1.0, carbs=1.0, fiber=5.0)
        veg = Ingredient(product_id="veg", kcal=34, fat=0.4, protein=2.8, carbs=6.6, fiber=2.6)

        result = solve(
            [oil, odd, veg],
            Targets(ratio=3.0, kcal=400, per_ingredient_bounds={"odd": (100.0, 100.0)}),
        )

        assert result.dish.ratio == pytest.approx(3.0, abs=RATIO_TOLERANCE)
        assert result.ratio_within_tolerance is True
        # Клетчатка `odd` не ушла в минус: его вклад в чистые углеводы — ноль,
        # и все 6,6 г знаменателя пришли от овоща.
        assert result.dish.net_carbs_g == pytest.approx(6.6, abs=0.05)

    def test_carbs_limit_counts_all_carbs(self) -> None:
        """Лимит углеводов остаётся по общим — это ответ на вопрос 3.

        Значение подобрано так, чтобы оно РАЗЛИЧАЛО правила: решение требует
        около 15 г общих углеводов при 9 г чистых. По общим лимит в 10 г
        недостижим, по чистым — достижим. Возьми кто-нибудь лимит от чистых, и
        задача стала бы разрешимой, а тест — упал.
        """
        fat = Ingredient(product_id="oil", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        veg = Ingredient(product_id="veg", kcal=34, fat=0.4, protein=2.8, carbs=6.6, fiber=2.6)

        targets = Targets(ratio=3.0, kcal=500, carbs_max_g=10.0)
        with pytest.raises(InfeasibleError):
            solve([fat, veg], targets)

        # Без лимита та же задача решается, то есть неразрешимость выше — от
        # лимита, а не от недостижимого соотношения.
        solved = solve([fat, veg], Targets(ratio=3.0, kcal=500))
        assert solved.dish.carbs_g > 10.0
        assert solved.dish.net_carbs_g < 10.0

    def test_solver_targets_the_ratio_on_net_carbs(self) -> None:
        """Подбор и проверка считают одинаково — иначе они разойдутся.

        Набор выбран так, что решателю НЕЧЕМ обойти клетчатку: источник белка и
        углеводов один, и он же богат клетчаткой. По чистым углеводам задача
        решается почти одним авокадо; по общим потребовалось бы вчетверо больше
        масла, и состав вышел бы совсем другим.

        Без этого случая учёт клетчатки в решателе не проверялся ничем: в
        единственном эталоне с клетчаткой продукт с ней в решение не попадал.
        """
        oil = Ingredient(product_id="oil", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        avocado = Ingredient(
            product_id="avocado", kcal=160, fat=14.7, protein=2.0, carbs=8.5, fiber=6.7
        )

        result = solve([oil, avocado], Targets(ratio=4.0, kcal=400))
        dish = result.dish
        used = {item.ingredient.product_id: item.grams for item in dish.items}

        # Решение держится на продукте с клетчаткой.
        assert used.get("avocado", 0.0) > 100.0
        assert result.ratio_within_tolerance is True

        # Соотношение попадает в цель по чистым углеводам…
        assert dish.ratio == pytest.approx(4.0, abs=RATIO_TOLERANCE)
        # …и далеко от неё по общим: правило именно то, а не другое.
        by_total_carbs = dish.fat_g / (dish.protein_g + dish.carbs_g)
        assert by_total_carbs < 2.0


class TestVerdictHasThreeStates:
    """«Не определено» — не то же самое, что «не соответствует».

    Прежде `within_tolerance` схлопывала отсутствующее соотношение в `False`, и
    день без вердикта доезжал до врача красной пометкой «питание вне допуска»
    (issue #204).
    """

    TARGETS = Targets(ratio=4.0, kcal=400)

    def test_missing_ratio_answers_none(self) -> None:
        oil = Ingredient(product_id="oil", kcal=884, fat=100.0, protein=0.0, carbs=0.0)
        dish = verify([(oil, 44.0)])
        assert dish.ratio is None

        ratio_within, kcal_within = within_tolerance(dish, self.TARGETS)
        assert ratio_within is None, "отсутствующее соотношение выдано как нарушение"
        # Калорийность считается всегда: она есть у любого блюда.
        assert kcal_within is True

    def test_ratio_off_target_still_answers_false(self) -> None:
        """Настоящее нарушение обязано остаться `False`, а не стать `None`."""
        lean = Ingredient(product_id="lean", kcal=400, fat=0.0, protein=100.0, carbs=0.0)
        dish = verify([(lean, 100.0)])
        assert dish.ratio == pytest.approx(0.0)

        ratio_within, _ = within_tolerance(dish, self.TARGETS)
        assert ratio_within is False

    def test_ratio_on_target_answers_true(self) -> None:
        fat = Ingredient(product_id="fat", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        protein = Ingredient(product_id="protein", kcal=400, fat=0.0, protein=100.0, carbs=0.0)
        dish = verify([(fat, 40.0), (protein, 10.0)])

        ratio_within, _ = within_tolerance(dish, self.TARGETS)
        assert ratio_within is True


class TestSolveWithoutRatio:
    """Решатель не выдаёт результат, о котором нечего сказать.

    У `verify()` соотношения может не быть — пустой знаменатель или незначимые
    чистые углеводы (ADR-0037). У решателя третьего состояния нет: равенство
    соотношения и есть ограничение задачи. Поэтому такой набор — неразрешимая
    задача с человекочитаемой причиной, а не результат с вердиктом «не
    соответствует» (issue #204).
    """

    def test_set_without_denominator_is_infeasible(self) -> None:
        oil = Ingredient(product_id="oil", kcal=900, fat=100.0, protein=0.0, carbs=0.0)
        # Клетчатка съедает все углеводы: чистых углеводов нет, белка нет тоже.
        fibrous = Ingredient(
            product_id="fibrous", kcal=40, fat=0.0, protein=0.0, carbs=10.0, fiber=10.0
        )

        with pytest.raises(InfeasibleError) as refusal:
            solve([oil, fibrous], Targets(ratio=4.0, kcal=400))

        # Текст проверяется по существу: он обязан назвать ПРИЧИНУ, а не просто
        # объявить задачу неразрешимой — человек читает его в баннере.
        message = str(refusal.value)
        assert "кетосоотношение не определяется" in message
        assert "клетчатк" in message


class TestDegenerateNetCarbs:
    """Чистые углеводы, неотличимые от ошибки вычитания, считаются нулём.

    Нашёл это property-тест `test_verify_scale_linear_in_mass`: у продукта, где
    клетчатка составляет почти все углеводы, `carbs - fiber` вырождается в
    мусор округления, и соотношение начинало зависеть от масштаба масс —
    2.25e14 на десяти граммах против 3.38e14 на тридцати.

    Все входы ниже — физичные (углеводы от 0.01 г на сто граммов, массы от
    0.1 г): каждая проверка стоит на значении, где мутация правила измеримо
    меняет ответ, а не на подобранном умозрительно.
    """

    DEGENERATE = Ingredient(
        product_id="degenerate",
        kcal=89.22043054338337,
        fat=1.0,
        protein=0.0,
        carbs=20.055107635845843,
        fiber=20.05510763584584,
    )

    def test_ratio_is_not_reported(self) -> None:
        assert verify([(self.DEGENERATE, 10.0)]).ratio is None

    def test_answer_does_not_depend_on_scale(self) -> None:
        light = verify([(self.DEGENERATE, 10.0)])
        heavy = verify([(self.DEGENERATE, 30.0)])
        assert light.ratio == heavy.ratio is None

    def test_insignificant_remainder_is_zeroed_not_refused(self) -> None:
        """Незначимый остаток обнуляется, а блюдо считается по белку.

        Первая редакция отвергала такие блюда целиком, и одно и то же блюдо на
        разных массах давало то число, то «не определено» — то есть
        воспроизводила дефект, который чинила.
        """
        with_protein = Ingredient(
            product_id="with_protein",
            kcal=100.0,
            fat=0.0,
            protein=1.0,
            carbs=5.689777411623246,
            fiber=5.689777411623245,
        )
        light = verify([(with_protein, 10.0)])
        heavy = verify([(with_protein, 10.0 * 0.01171875)])
        assert light.ratio == pytest.approx(0.0)
        assert heavy.ratio == pytest.approx(0.0)

    def test_significant_remainder_still_counts(self) -> None:
        """Порог относительный, и нормальная еда через него проходит.

        Углеводы 0.01 г на сто граммов при массе 0.1 г — исчезающе мало для
        клиники и вполне различимо для арифметики.
        """
        real_food = Ingredient(
            product_id="real_food", kcal=100.0, fat=10.0, protein=0.0, carbs=0.01, fiber=0.009
        )
        dish = verify([(real_food, 0.1)])
        assert dish.ratio is not None
        assert dish.ratio == pytest.approx(10.0 / 0.001, rel=1e-6)

    def test_threshold_is_measured_against_both_terms(self) -> None:
        """Мерой служит сумма углеводов и клетчатки, а не одни углеводы.

        Свидетель найден перебором: при `carbs = 0.01`, `fiber = 0.00999999999`
        и массе 0.1 г ответы двух версий расходятся.
        """
        borderline = Ingredient(
            product_id="borderline",
            kcal=100.0,
            fat=10.0,
            protein=0.0,
            carbs=0.01,
            fiber=0.00999999999,
        )
        assert verify([(borderline, 0.1)]).ratio is None

    def test_exact_cancellation_is_not_an_error(self) -> None:
        """Клетчатка ровно равна углеводам — ошибки нет, знаменатель это белок."""
        tiny = 2.104906845937254e-13
        exact = Ingredient(
            product_id="exact", kcal=1.0, fat=tiny, protein=tiny, carbs=tiny, fiber=tiny
        )
        for grams in (10.0, 0.1, 0.001):
            assert verify([(exact, grams)]).ratio == pytest.approx(1.0), f"на {grams} г"

    def test_verdict_does_not_depend_on_a_cancelled_column(self) -> None:
        """Столбец, сократившийся начисто, на вердикт не влияет."""
        for carbs in (1.5, 50.0, 500.0):
            same = Ingredient(
                product_id=f"c{carbs}", kcal=1.0, fat=10.0, protein=1.0, carbs=carbs, fiber=carbs
            )
            assert verify([(same, 100.0)]).ratio == pytest.approx(10.0), f"carbs={carbs}"

    def test_infinite_ratio_is_not_a_number(self) -> None:
        """Бесконечность наружу не уходит: 52 случая на 29 тысяч в прогоне."""
        denormal = Ingredient(
            product_id="denormal",
            kcal=234.0,
            fat=26.00299225719645,
            protein=2.225073858507e-311,
            carbs=2.225073858507e-311,
            fiber=2.225073858507e-311,
        )
        assert verify([(denormal, 10.0)]).ratio is None

    def test_zero_denominator_answers_the_same_way(self) -> None:
        oil = Ingredient(product_id="oil", kcal=884, fat=100.0, protein=0.0, carbs=0.0)
        assert verify([(oil, 50.0)]).ratio is None

    def test_solver_does_not_offer_such_a_dish(self) -> None:
        with pytest.raises(InfeasibleError):
            solve([self.DEGENERATE], Targets(ratio=4.0, kcal=400))


class TestItemNetCarbs:
    def test_positions_sum_to_the_dish_and_never_go_negative(self) -> None:
        fibrous = Ingredient("fibrous", kcal=30, fat=0, protein=1, carbs=5, fiber=7)
        plain = Ingredient("plain", kcal=60, fat=0, protein=1, carbs=10, fiber=2)

        dish = verify([(fibrous, 100.0), (plain, 50.0)])

        assert dish.items[0].net_carbs_g == 0.0
        assert dish.items[1].net_carbs_g == pytest.approx(4.0)
        assert sum(item.net_carbs_g for item in dish.items) == pytest.approx(dish.net_carbs_g)


class TestMealMacroGoal:
    def test_goal_reproduces_the_ratio_and_the_calories(self) -> None:
        goal = meal_macro_goal(4.0, 400.0, day_protein_g=24.0, day_kcal=1600.0)

        assert goal.non_fat_g == pytest.approx(10.0)
        assert goal.fat_g == pytest.approx(40.0)
        assert goal.protein_g == pytest.approx(6.0)
        assert goal.net_carbs_g == pytest.approx(4.0)
        assert goal.fat_g / goal.non_fat_g == pytest.approx(4.0)
        assert 9 * goal.fat_g + 4 * goal.non_fat_g == pytest.approx(400.0)

    def test_protein_follows_the_share_of_daily_calories(self) -> None:
        small = meal_macro_goal(4.0, 100.0, day_protein_g=24.0, day_kcal=1600.0)

        assert small.protein_g == pytest.approx(1.5)

    def test_without_a_daily_target_the_split_is_unknown(self) -> None:
        goal = meal_macro_goal(3.0, 310.0)

        assert goal.protein_g is None
        assert goal.net_carbs_g is None
        assert goal.non_fat_g == pytest.approx(10.0)

    def test_protein_that_does_not_fit_is_not_shown(self) -> None:
        goal = meal_macro_goal(5.0, 98.0, day_protein_g=200.0, day_kcal=400.0)

        assert goal.protein_g is None
        assert goal.net_carbs_g is None

    def test_rejects_non_positive_daily_calories(self) -> None:
        with pytest.raises(ValueError):
            meal_macro_goal(4.0, 400.0, day_protein_g=24.0, day_kcal=0.0)


class TestEnergyRequirement:
    """Yonsei table, question 56: kcal range = weight x kcal/kg of the age row."""

    @pytest.mark.parametrize(
        ("age", "weight", "expected"),
        [
            (0, 8.0, (600.0, 680.0)),
            (1, 10.0, (700.0, 750.0)),
            (3, 10.0, (700.0, 750.0)),
            (4, 18.0, (1170.0, 1224.0)),
            (6, 18.0, (1170.0, 1224.0)),
            (7, 25.0, (1375.0, 1500.0)),
            (10, 25.0, (1375.0, 1500.0)),
            (11, 40.0, (1200.0, 1600.0)),
            (17, 50.0, (1500.0, 2000.0)),
            # The dietitian's two children of 2026-11-12, both 23 kg: the age row,
            # not the weight, makes the difference.
            (13, 23.0, (690.0, 920.0)),
            (6, 23.0, (1495.0, 1564.0)),
        ],
    )
    def test_rows_by_full_years(self, age, weight, expected):
        from keto_engine import energy_requirement

        assert energy_requirement(age, weight) == pytest.approx(expected)

    @pytest.mark.parametrize(("age", "weight"), [(-1, 10.0), (5, 0.0), (5, -3.0)])
    def test_rejects_impossible_input(self, age, weight):
        from keto_engine import energy_requirement

        with pytest.raises(ValueError):
            energy_requirement(age, weight)


class TestDietaryUnit:
    """The clinic's Yonsei slide: one unit is R g fat + 1 g protein with carbs."""

    @pytest.mark.parametrize(
        ("ratio", "kcal"), [(4.0, 40.0), (3.0, 31.0), (2.5, 26.5), (1.0, 13.0)]
    )
    def test_unit_energy(self, ratio, kcal):
        from keto_engine import dietary_unit_kcal

        assert dietary_unit_kcal(ratio) == pytest.approx(kcal)

    @pytest.mark.parametrize(("ratio", "units"), [(4.0, 25.0), (3.0, 1000.0 / 31.0)])
    def test_unit_count_is_protein_with_carbs(self, ratio, units):
        from keto_engine import dietary_unit_kcal, max_non_fat_grams

        assert 1000.0 / dietary_unit_kcal(ratio) == pytest.approx(units)
        assert max_non_fat_grams(ratio, 1000.0) == pytest.approx(units)

    @pytest.mark.parametrize("ratio", [0.0, -1.0])
    def test_rejects_non_positive_ratio(self, ratio):
        from keto_engine import dietary_unit_kcal

        with pytest.raises(ValueError):
            dietary_unit_kcal(ratio)


class TestProteinRequirement:
    @pytest.mark.parametrize(("weight", "expected"), [(23.0, 23.0), (18.5, 18.5), (4.2, 4.2)])
    def test_one_gram_per_kilogram(self, weight, expected):
        from keto_engine import protein_requirement

        assert protein_requirement(weight) == pytest.approx(expected)

    @pytest.mark.parametrize("weight", [0.0, -1.0])
    def test_rejects_impossible_weight(self, weight):
        from keto_engine import protein_requirement

        with pytest.raises(ValueError):
            protein_requirement(weight)


class TestFluidRequirement:
    """Holliday-Segar: 100 mL/kg to 10 kg, +50 mL/kg to 20 kg, +20 mL/kg above."""

    @pytest.mark.parametrize(
        ("weight", "expected"),
        [
            (5.0, 500.0),
            (10.0, 1000.0),
            (15.0, 1250.0),
            (20.0, 1500.0),
            (30.0, 1700.0),
            (0.5, 50.0),
        ],
    )
    def test_bands(self, weight, expected):
        from keto_engine import fluid_requirement

        assert fluid_requirement(weight) == pytest.approx(expected)

    @pytest.mark.parametrize("weight", [0.0, -1.0])
    def test_rejects_impossible_weight(self, weight):
        from keto_engine import fluid_requirement

        with pytest.raises(ValueError):
            fluid_requirement(weight)


class TestMacroFit:
    """Where a dish sits against the protein and net carbs of its meal."""

    EGG = Ingredient("egg", kcal=139.0, fat=9.5, protein=12.6, carbs=0.7)

    def test_nothing_to_compare_without_goals(self) -> None:
        assert macro_fit(verify([(self.EGG, 50.0)]), None, None) is None

    def test_deltas_are_fact_minus_goal(self) -> None:
        dish = verify([(self.EGG, 100.0)])
        fit = macro_fit(dish, 10.0, 2.0)
        assert fit is not None
        assert fit.protein_delta_g == pytest.approx(2.6)
        assert fit.net_carbs_delta_g == pytest.approx(-1.3)
        assert not fit.within_tolerance

    def test_one_gram_either_way_still_matches(self) -> None:
        dish = verify([(self.EGG, 100.0)])
        fit = macro_fit(dish, 12.6 - MEAL_MACRO_TOLERANCE_G, 0.7 + MEAL_MACRO_TOLERANCE_G)
        assert fit is not None and fit.within_tolerance

    def test_a_single_goal_is_judged_alone(self) -> None:
        dish = verify([(self.EGG, 100.0)])
        fit = macro_fit(dish, None, 0.5)
        assert fit is not None
        assert fit.protein_delta_g is None
        assert fit.net_carbs_delta_g == pytest.approx(0.2)
        assert fit.within_tolerance


class TestCarbsLimitAgainstTheCarbsGoal:
    """The limit counts all carbs, the goal counts net carbs (ADR-0083).

    Five meals "on goal" with vegetables came to 29 g of carbs under a
    prescription whose limit was 21.5 g: the fibre was on top of the goal.
    """

    PEPPER = Ingredient("pepper", kcal=31.0, fat=0.3, protein=1.0, carbs=6.0, fiber=2.0)
    EGG = Ingredient("egg", kcal=139.0, fat=9.5, protein=12.6, carbs=0.7)

    def test_goal_never_exceeds_the_meals_share_of_the_limit(self) -> None:
        goal = meal_macro_goal(
            3.0, 276.0, day_protein_g=23.0, day_kcal=1380.0, day_carbs_limit_g=10.0
        )
        assert goal.net_carbs_g == pytest.approx(2.0)
        # The ratio and the calories fix the sum: what carbs give up is protein.
        assert goal.protein_g == pytest.approx(goal.non_fat_g - 2.0)

    def test_limit_above_the_remainder_changes_nothing(self) -> None:
        free = meal_macro_goal(3.0, 276.0, day_protein_g=23.0, day_kcal=1380.0)
        capped = meal_macro_goal(
            3.0, 276.0, day_protein_g=23.0, day_kcal=1380.0, day_carbs_limit_g=40.0
        )
        assert capped == free

    def test_dish_at_the_ceiling_is_not_short_of_carbs(self) -> None:
        # 65 g of pepper: 3.9 g of carbs, 1.3 g of them fibre, 2.6 g net.
        dish = verify([(self.PEPPER, 65.0), (self.EGG, 40.0)])
        unlimited = macro_fit(dish, 4.6, 4.3)
        limited = macro_fit(dish, 4.6, 4.3, carbs_max_g=4.3)
        assert unlimited is not None and not unlimited.within_tolerance
        assert limited is not None
        assert limited.carbs_limited_by_g == pytest.approx(1.3)
        assert limited.net_carbs_delta_g == pytest.approx(-0.12, abs=0.01)
        assert limited.protein_delta_g == pytest.approx(-0.21, abs=0.01)
        assert limited.within_tolerance

    def test_dish_over_the_limit_is_a_miss(self) -> None:
        dish = verify([(self.PEPPER, 110.0), (self.EGG, 30.0)])
        fit = macro_fit(dish, 4.6, 4.3, carbs_max_g=4.3)
        assert fit is not None and not fit.within_tolerance
        assert fit.net_carbs_delta_g is not None and fit.net_carbs_delta_g > 1.0

    def test_solver_keeps_the_limit_and_gets_as_close_as_it_allows(self) -> None:
        products = list(TestSolveAimsAtTheMealSplit.PRODUCTS)
        result = solve(
            products,
            Targets(
                ratio=3.0,
                kcal=276.0,
                carbs_max_g=4.3,
                per_ingredient_bounds=TestSolveAimsAtTheMealSplit.BOUNDS,
                protein_g=4.6,
                net_carbs_g=4.3,
            ),
        )
        assert result.dish.carbs_g <= 4.3
        assert result.ratio_within_tolerance and result.kcal_within_tolerance
        fit = result.macro_fit
        assert fit is not None and fit.within_tolerance
        assert fit.carbs_limited_by_g > 0.5


class TestSplitIsHeldWhenADishInsideItExists:
    """Findings of the safety review of ADR-0083."""

    @staticmethod
    def _product(name: str, fat: float, protein: float, carbs: float, fiber: float = 0.0):
        return Ingredient(
            name,
            kcal=9 * fat + 4 * protein + 4 * carbs,
            fat=fat,
            protein=protein,
            carbs=carbs,
            fiber=fiber,
        )

    def test_exact_calories_do_not_buy_a_split_outside_its_tolerance(self) -> None:
        """Oil, cheese, avocado at 4:1 and 400 kcal: the sum of deviations
        preferred exact calories and returned carbs 1.24 g short, while a dish
        with every goal inside its tolerance existed."""
        products = [
            self._product("oil", 99.9, 0.0, 0.0),
            self._product("cheese", 29.0, 23.0, 0.3),
            self._product("avocado", 14.7, 2.0, 8.5, 6.7),
        ]
        result = solve(
            products,
            Targets(
                ratio=4.0,
                kcal=400.0,
                per_ingredient_bounds={p.product_id: (2.0, 5000.0) for p in products},
                protein_g=5.64,
                net_carbs_g=4.36,
            ),
        )
        assert result.ratio_within_tolerance and result.kcal_within_tolerance
        assert result.macro_fit is not None and result.macro_fit.within_tolerance

    def test_goals_next_to_a_hard_limit_do_not_turn_a_dish_into_a_refusal(self) -> None:
        """With the carbs goal equal to the carbs limit the exact solution sat
        on the limit, rounding broke it, and a request that solves without the
        goals was refused."""
        products = [
            self._product("apple", 0.4, 0.4, 9.8, 1.8),
            self._product("strawberry", 0.4, 0.8, 7.5, 2.2),
            self._product("butter", 82.5, 0.5, 0.8),
            self._product("mayo", 67.0, 2.8, 3.7),
            self._product("salmon", 15.0, 20.0, 0.0),
            self._product("oil", 99.9, 0.0, 0.0),
            self._product("mct", 100.0, 0.0, 0.0),
        ]
        targets = Targets(
            ratio=4.0,
            kcal=400.0,
            carbs_max_g=6.9,
            per_ingredient_bounds={p.product_id: (2.0, 5000.0) for p in products},
            protein_g=3.1,
            net_carbs_g=6.9,
        )
        result = solve(products, targets)
        assert result.dish.carbs_g <= 6.9
        assert result.ratio_within_tolerance and result.kcal_within_tolerance
        assert result.macro_fit is not None and result.macro_fit.within_tolerance

    def test_a_dish_that_solves_without_the_wishes_is_never_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Whatever the goals and the entered masses do to the search, the
        last attempt runs without them."""
        real = engine_module._solve

        def refuses_with_wishes(ingredients, targets, leave_rounding_room):
            if targets.protein_g is not None:
                raise InfeasibleError("с пожеланиями не сошлось")
            return real(ingredients, targets, leave_rounding_room)

        monkeypatch.setattr(engine_module, "_solve", refuses_with_wishes)
        products = list(TestSolveAimsAtTheMealSplit.PRODUCTS)
        result = solve(
            products,
            Targets(ratio=3.0, kcal=276.0, protein_g=4.6, net_carbs_g=4.3, carbs_max_g=10.0),
        )
        assert result.ratio_within_tolerance and result.kcal_within_tolerance
        # Judged against the goals that were asked for, not silently dropped.
        assert result.macro_fit is not None

    def test_split_inside_tolerance_outranks_a_closer_sum(self) -> None:
        products = list(TestSolveAimsAtTheMealSplit.PRODUCTS)
        targets = Targets(ratio=3.0, kcal=276.0, protein_g=4.6, net_carbs_g=4.3)
        inside = _candidate_rank([25.0, 23.0, 13.0, 87.0], products, targets)
        outside = _candidate_rank([61.0, 23.0, 6.0, 5.0], products, targets)
        assert inside is not None and outside is not None
        assert not inside[2] and outside[2]
        assert inside < outside


class TestSolveAimsAtTheMealSplit:
    """The dietitian's complaint of 2026-11-15 (ADR-0083).

    The solver held the ratio and the calories and gave the meal 8.1 g of
    protein and 0.8 g of carbs against a goal of 4.6 and 4.3. The products
    could reach the goal; nothing asked the solver to.
    """

    EGG = Ingredient("egg", kcal=139.0, fat=9.5, protein=12.6, carbs=0.7)
    BUTTER = Ingredient("butter", kcal=735.0, fat=81.3, protein=0.9, carbs=0.1)
    CREAM = Ingredient("cream", kcal=347.0, fat=36.0, protein=2.5, carbs=3.2)
    PEPPER = Ingredient("pepper", kcal=31.0, fat=0.3, protein=1.0, carbs=6.0, fiber=2.0)
    PRODUCTS = (EGG, BUTTER, CREAM, PEPPER)
    ENTERED = {"egg": 61.0, "butter": 23.0, "cream": 6.0, "pepper": 5.0}
    BOUNDS = {name: (2.0, 5000.0) for name in ENTERED}

    def _goal(self) -> MealMacroGoal:
        return meal_macro_goal(3.0, 276.0, day_protein_g=23.0, day_kcal=1380.0)

    def test_without_the_goals_the_split_is_not_judged(self) -> None:
        result = solve(
            list(self.PRODUCTS), Targets(ratio=3.0, kcal=276.0, per_ingredient_bounds=self.BOUNDS)
        )
        assert result.macro_fit is None

    def test_protein_and_net_carbs_reach_the_goal(self) -> None:
        goal = self._goal()
        result = solve(
            list(self.PRODUCTS),
            Targets(
                ratio=3.0,
                kcal=276.0,
                per_ingredient_bounds=self.BOUNDS,
                protein_g=goal.protein_g,
                net_carbs_g=goal.net_carbs_g,
            ),
        )
        assert result.ratio_within_tolerance and result.kcal_within_tolerance
        assert result.macro_fit is not None and result.macro_fit.within_tolerance
        assert result.dish.protein_g == pytest.approx(4.6, abs=0.5)
        assert result.dish.net_carbs_g == pytest.approx(4.3, abs=0.5)

    def test_goals_out_of_reach_are_reported_not_refused(self) -> None:
        """Egg and butter hold no carbs to speak of: the ratio and calories
        still come out, and the result says how far the split is."""
        goal = self._goal()
        result = solve(
            [self.EGG, self.BUTTER],
            Targets(ratio=3.0, kcal=276.0, protein_g=goal.protein_g, net_carbs_g=goal.net_carbs_g),
        )
        assert result.ratio_within_tolerance and result.kcal_within_tolerance
        fit = result.macro_fit
        assert fit is not None and not fit.within_tolerance
        assert fit.protein_delta_g is not None and fit.protein_delta_g > 1.0
        assert fit.net_carbs_delta_g is not None and fit.net_carbs_delta_g < -1.0

    def test_goals_never_break_the_minimum_or_the_limit(self) -> None:
        goal = self._goal()
        result = solve(
            list(self.PRODUCTS),
            Targets(
                ratio=3.0,
                kcal=276.0,
                protein_min_g=6.0,
                carbs_max_g=3.0,
                per_ingredient_bounds=self.BOUNDS,
                protein_g=goal.protein_g,
                net_carbs_g=goal.net_carbs_g,
            ),
        )
        assert result.dish.protein_g >= 6.0
        assert result.dish.carbs_g <= 3.0


class TestSolveStaysNearTheEnteredDish:
    """Of the dishes that reach the goals, the one that moves the fewest grams."""

    PRODUCTS = TestSolveAimsAtTheMealSplit.PRODUCTS
    ENTERED = TestSolveAimsAtTheMealSplit.ENTERED
    BOUNDS = TestSolveAimsAtTheMealSplit.BOUNDS

    def _targets(self, **extra: object) -> Targets:
        goal = meal_macro_goal(3.0, 276.0, day_protein_g=23.0, day_kcal=1380.0)
        return Targets(
            ratio=3.0,
            kcal=276.0,
            per_ingredient_bounds=self.BOUNDS,
            protein_g=goal.protein_g,
            net_carbs_g=goal.net_carbs_g,
            **extra,  # type: ignore[arg-type]
        )

    @staticmethod
    def _moved(result: SolveResult, entered: dict[str, float]) -> float:
        grams = {item.ingredient.product_id: item.grams for item in result.dish.items}
        return sum(abs(grams.get(name, 0.0) - mass) for name, mass in entered.items())

    def test_the_dish_moves_less_and_still_reaches_the_goals(self) -> None:
        anywhere = solve(list(self.PRODUCTS), self._targets())
        near = solve(list(self.PRODUCTS), self._targets(near_grams=self.ENTERED))

        assert near.macro_fit is not None and near.macro_fit.within_tolerance
        assert near.ratio_within_tolerance and near.kcal_within_tolerance
        assert self._moved(near, self.ENTERED) < self._moved(anywhere, self.ENTERED)

    def test_a_dish_already_on_target_is_left_alone(self) -> None:
        first = solve(list(self.PRODUCTS), self._targets(near_grams=self.ENTERED))
        grams = {item.ingredient.product_id: item.grams for item in first.dish.items}
        again = solve(list(self.PRODUCTS), self._targets(near_grams=grams))
        assert self._moved(again, grams) <= 4.0

    def test_masses_of_products_not_in_the_dish_are_ignored(self) -> None:
        result = solve(list(self.PRODUCTS), self._targets(near_grams={"not-here": 40.0}))
        assert result.macro_fit is not None and result.macro_fit.within_tolerance

    def test_a_failed_second_pass_keeps_the_first_answer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The second pass only chooses between dishes that already reach the
        goals: if it comes back empty, the first pass still stands."""
        real = engine_module._build_and_solve

        def first_pass_only(*args: object, **kwargs: object) -> object:
            if kwargs.get("goal_budget") is not None:
                return OptimizeResult(success=False)
            return real(*args, **kwargs)  # type: ignore[arg-type]

        monkeypatch.setattr(engine_module, "_build_and_solve", first_pass_only)
        result = solve(list(self.PRODUCTS), self._targets(near_grams=self.ENTERED))
        assert result.macro_fit is not None and result.macro_fit.within_tolerance


class TestMedicalConstantsAreWhatTheyWereAgreedToBe:
    """A changed tolerance must fail a test that names it.

    The audit of 2026-11-15 changed these one at a time and the suite stayed
    green: every other test reads the constant it is supposed to check.
    """

    def test_values(self) -> None:
        assert RATIO_TOLERANCE == 0.15
        assert KCAL_TOLERANCE_FRACTION == 0.05
        assert MEAL_MACRO_TOLERANCE_G == 1.0
        assert MIN_INGREDIENT_GRAMS == 2.0
        assert GRAM_ROUNDING == 1

    BUTTER = Ingredient("butter", kcal=0.0, fat=80.0, protein=0.0, carbs=0.0)
    CURD = Ingredient("curd", kcal=0.0, fat=0.0, protein=20.0, carbs=0.0)

    def _verdict(self, butter: float, curd: float, ratio: float, kcal: float):
        return within_tolerance(
            verify([(self.BUTTER, butter), (self.CURD, curd)]), Targets(ratio=ratio, kcal=kcal)
        )

    def test_calories_are_judged_on_both_sides(self) -> None:
        # 50 g butter + 50 g curd: 4.0 : 1 and 400 kcal.
        assert self._verdict(50, 50, 4.0, 400.0) == (True, True)
        assert self._verdict(50, 50, 4.0, 381.0)[1] is True  # 5 % of 381 is 19.05
        assert self._verdict(50, 50, 4.0, 379.0)[1] is False  # dish is above the corridor
        assert self._verdict(50, 50, 4.0, 421.0)[1] is True  # 5 % of 421 is 21.05
        assert self._verdict(50, 50, 4.0, 423.0)[1] is False  # dish is below the corridor

    def test_ratio_is_judged_on_both_sides_and_the_edge_counts(self) -> None:
        assert self._verdict(50, 50, 3.86, 400.0)[0] is True
        assert self._verdict(50, 50, 4.14, 400.0)[0] is True
        assert self._verdict(50, 50, 3.84, 400.0)[0] is False
        assert self._verdict(50, 50, 4.16, 400.0)[0] is False
        # Exactly on the edge counts as inside: 52 g of curd give 3.846…, and
        # 3.85 − 0.15 = 3.70 is the edge for 54.054… g; taken on round numbers.
        edge = within_tolerance(
            verify([(self.BUTTER, 83.0), (self.CURD, 80.0)]), Targets(ratio=4.0, kcal=917.6)
        )
        assert edge[0] is True  # 4.15 : 1 exactly

    def test_a_gram_and_a_half_is_dropped_and_two_grams_are_kept(self) -> None:
        targets = Targets(ratio=4.0, kcal=400.0)
        thin = _candidate_rank([50.0, 1.0], [self.BUTTER, self.CURD], targets)
        assert thin is None  # curd under the minimum leaves butter alone: no ratio
        kept = _candidate_rank([50.0, 2.0], [self.BUTTER, self.CURD], targets)
        assert kept is not None

    def test_distance_counts_the_ratio_and_the_calories(self) -> None:
        targets = Targets(ratio=4.0, kcal=400.0)
        on_goal = _candidate_rank([50.0, 50.0], [self.BUTTER, self.CURD], targets)
        off_ratio = _candidate_rank([49.0, 52.0], [self.BUTTER, self.CURD], targets)
        off_kcal = _candidate_rank([51.0, 51.0], [self.BUTTER, self.CURD], targets)
        assert on_goal is not None and off_ratio is not None and off_kcal is not None
        assert on_goal[3] == pytest.approx(0.0, abs=1e-9)
        # 49 / 52: ratio 3.769 (0.231 off, 1.54 tolerances), 394.4 kcal (0.28).
        assert off_ratio[3] == pytest.approx(0.231 / 0.15 + 5.6 / 20, abs=0.01)
        # 51 / 51: ratio 4.0, 408 kcal (0.4 of the tolerance).
        assert off_kcal[3] == pytest.approx(0.4, abs=1e-6)


class TestVerifyRefusesWhatIsNotADish:
    def test_negative_mass(self) -> None:
        oil = Ingredient("oil", kcal=900.0, fat=100.0, protein=0.0, carbs=0.0)
        with pytest.raises(ValueError):
            verify([(oil, -10.0)])


class TestMealCalories:
    @pytest.mark.parametrize(
        "day,meals,expected",
        [(1380, 5, 276.0), (1575, 6, 263.0), (1250, 4, 313.0), (1050, 4, 263.0), (1100, 3, 367.0)],
    )
    def test_halves_round_up_as_on_screen(self, day, meals, expected) -> None:
        """1575 / 6 = 262.5: Python's round() gives 262, the screen shows 263."""
        assert meal_kcal(day, meals) == expected

    @pytest.mark.parametrize("day,meals", [(0, 4), (1200, 0), (-5, 3)])
    def test_rejects_impossible_input(self, day, meals) -> None:
        with pytest.raises(ValueError):
            meal_kcal(day, meals)


class TestSolverFindsTheDishThatExists:
    """Audit of 2026-11-15, finding A1."""

    @staticmethod
    def _product(name: str, fat: float, protein: float, carbs: float, fiber: float = 0.0):
        return Ingredient(
            name,
            kcal=9 * fat + 4 * protein + 4 * carbs,
            fat=fat,
            protein=protein,
            carbs=carbs,
            fiber=fiber,
        )

    def test_pinned_mass_does_not_refuse_a_dish_inside_both_tolerances(self) -> None:
        """Liver pinned at 59 g, 2.5 : 1, 360 kcal. No mass of oil puts the ratio
        exactly on 2.5 inside the calorie corridor, and the solver said the
        bounds were too narrow. Oil 32 g gives 2.39 and 364 kcal: on target."""
        oil = self._product("oil", 100.0, 0.0, 0.0)
        liver = self._product("liver", 3.7, 17.9, 5.3)
        result = solve(
            [oil, liver],
            Targets(ratio=2.5, kcal=360.0, per_ingredient_bounds={"liver": (59.0, 59.0)}),
        )
        grams = {item.ingredient.product_id: item.grams for item in result.dish.items}
        assert grams["liver"] == 59.0
        assert result.ratio_within_tolerance and result.kcal_within_tolerance

    def test_pins_that_rule_the_ratio_out_are_named(self) -> None:
        """Oil 5 g and chicken 100 g, both pinned, at 4 : 1: the products can
        make the ratio, the pinned masses cannot, and the reason says so."""
        oil = self._product("oil", 100.0, 0.0, 0.0)
        chicken = self._product("chicken", 1.9, 23.6, 0.4)
        targets = Targets(
            ratio=4.0,
            kcal=300.0,
            per_ingredient_bounds={"oil": (5.0, 5.0), "chicken": (100.0, 100.0)},
        )
        with pytest.raises(InfeasibleError, match="снимите закрепление"):
            solve([oil, chicken], targets)

    def test_masses_that_never_reach_the_minimum_say_so(self) -> None:
        """Bounds that keep every product under the minimum mass leave nothing
        to make a dish of, and the reason is that, not a ratio that "cannot be
        determined"."""
        blend = self._product("blend", 40.0, 10.0, 0.0)
        with pytest.raises(InfeasibleError, match="слишком мала"):
            solve(
                [blend],
                Targets(ratio=4.0, kcal=3.0, per_ingredient_bounds={"blend": (0.0, 1.0)}),
            )

    def test_one_kilocalorie_gets_the_smallest_dish_and_an_honest_verdict(self) -> None:
        blend = self._product("blend", 40.0, 10.0, 0.0)
        result = solve([blend], Targets(ratio=4.0, kcal=1.0))
        assert result.dish.items[0].grams == 2.0
        assert result.kcal_within_tolerance is False

    def test_a_limit_is_printed_as_a_person_would_write_it(self) -> None:
        apple = self._product("apple", 0.4, 0.4, 9.8, 1.8)
        butter = self._product("butter", 82.5, 0.5, 0.8)
        with pytest.raises(InfeasibleError) as refusal:
            solve([apple, butter], Targets(ratio=4.0, kcal=300.0, carbs_max_g=0.141666667))
        assert "0.14 г" in refusal.value.reason
        assert "0.141666" not in refusal.value.reason

    def test_better_treats_no_rank_as_worse_than_any(self) -> None:
        rank = (False, False, False, 0.5)
        assert _better(rank, None)
        assert not _better(None, rank)
        assert not _better(rank, (False, False, False, 0.5))


class TestSolvingOnesOwnAnswerChangesNothing:
    """Audit of 2026-11-15, finding A2: the dietitian's "сбивается"."""

    PRODUCTS = TestSolveAimsAtTheMealSplit.PRODUCTS
    BOUNDS = TestSolveAimsAtTheMealSplit.BOUNDS

    def _targets(self) -> Targets:
        return Targets(
            ratio=3.0,
            kcal=276.0,
            carbs_max_g=4.3,
            per_ingredient_bounds=self.BOUNDS,
            protein_g=4.6,
            net_carbs_g=4.3,
        )

    @staticmethod
    def _grams(result: SolveResult) -> dict[str, float]:
        return {item.ingredient.product_id: item.grams for item in result.dish.items}

    def test_the_answer_is_a_fixed_point(self) -> None:
        first = solve(list(self.PRODUCTS), self._targets())
        again = refine(
            [(item.ingredient, item.grams) for item in first.dish.items], self._targets()
        )
        assert again is not None
        assert self._grams(again) == self._grams(first)

    def test_a_dish_on_target_is_polished_not_reshaped(self) -> None:
        """Entered by hand and inside every tolerance: the grams move by a few,
        towards the goal, and stay there on the next press."""
        first = solve(list(self.PRODUCTS), self._targets())
        entered = self._grams(first)
        entered["butter"] += 1.0
        items = [(product, entered[product.product_id]) for product in self.PRODUCTS]
        polished = refine(items, self._targets())
        assert polished is not None
        moved = sum(abs(self._grams(polished)[name] - mass) for name, mass in entered.items())
        assert moved <= 4.0
        once_more = refine(
            [(item.ingredient, item.grams) for item in polished.dish.items], self._targets()
        )
        assert once_more is not None and self._grams(once_more) == self._grams(polished)

    def test_a_dish_off_target_is_left_to_the_solver(self) -> None:
        entered = {"egg": 61.0, "butter": 23.0, "cream": 6.0, "pepper": 5.0}
        items = [(product, entered[product.product_id]) for product in self.PRODUCTS]
        assert refine(items, self._targets()) is None

    def test_fractional_or_missing_masses_are_left_to_the_solver(self) -> None:
        first = solve(list(self.PRODUCTS), self._targets())
        items = [(item.ingredient, item.grams) for item in first.dish.items]
        assert refine([], self._targets()) is None
        assert refine([(items[0][0], items[0][1] + 0.5), *items[1:]], self._targets()) is None

    def test_a_product_under_the_minimum_mass_is_left_to_the_solver(self) -> None:
        butter = Ingredient("butter", kcal=0.0, fat=80.0, protein=0.0, carbs=0.0)
        curd = Ingredient("curd", kcal=0.0, fat=0.0, protein=20.0, carbs=0.0)
        trace = Ingredient("trace", kcal=0.0, fat=0.0, protein=0.0, carbs=1.0)
        on_target = refine([(butter, 50.0), (curd, 50.0)], Targets(ratio=4.0, kcal=400.0))
        assert on_target is not None
        with_trace = refine(
            [(butter, 50.0), (curd, 50.0), (trace, 1.0)], Targets(ratio=4.0, kcal=400.0)
        )
        assert with_trace is None

    def test_polishing_never_takes_a_product_out_of_the_dish(self) -> None:
        """With no lower bound sent, a gram moved from a 2 g product would leave
        it under the minimum mass and out of the dish: not the dish entered."""
        butter = Ingredient("butter", kcal=0.0, fat=80.0, protein=0.0, carbs=0.0)
        curd = Ingredient("curd", kcal=0.0, fat=0.0, protein=20.0, carbs=0.0)
        herb = Ingredient("herb", kcal=0.0, fat=0.0, protein=3.0, carbs=6.0, fiber=3.0)
        for curd_grams in range(44, 52):
            polished = refine(
                [(butter, 50.0), (curd, float(curd_grams)), (herb, 2.0)],
                Targets(ratio=4.0, kcal=400.0),
            )
            if polished is not None:
                assert len(polished.dish.items) == 3
                assert min(item.grams for item in polished.dish.items) >= 2.0

    def test_the_answer_does_not_depend_on_the_order_of_products(self) -> None:
        forward = solve(list(self.PRODUCTS), self._targets())
        backward = solve(list(reversed(self.PRODUCTS)), self._targets())
        assert self._grams(forward) == self._grams(backward)
        assert [item.ingredient.product_id for item in backward.dish.items] == [
            product.product_id for product in reversed(self.PRODUCTS)
        ]

    def test_engine_version_was_raised_with_this_behaviour(self) -> None:
        major, minor, _ = (int(part) for part in ENGINE_VERSION.split("."))
        assert (major, minor) >= (1, 10)
