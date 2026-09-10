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
