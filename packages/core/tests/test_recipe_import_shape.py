"""The draft of a recipe file: grams are derived, never taken on trust (ADR-0079)."""

from __future__ import annotations

import pytest

from core import recipe_import as shape
from core.repositories.product_aliases import alias_key


class TestGrams:
    @pytest.mark.parametrize(
        ("quantity", "unit", "grams"),
        [
            (8.5, "g", 8.5),
            (0.5, "kg", 500.0),
            (500, "mg", 0.5),
            (2, "oz", 56.7),
            (1, "lb", 453.6),
            (30, " G ", 30.0),
        ],
    )
    def test_units_of_mass_are_converted_exactly(self, quantity, unit, grams):
        assert shape.to_grams(quantity, unit) == grams

    @pytest.mark.parametrize("unit", ["other", "ml", "cup", "tbsp", None])
    def test_anything_else_gives_no_grams(self, unit):
        """A spoon or a millilitre has no mass until the dietitian names it."""

        assert shape.to_grams(3, unit) is None

    def test_no_quantity_no_grams(self):
        assert shape.to_grams(None, "g") is None

    def test_a_mass_beyond_the_form_limit_is_not_accepted(self):
        """The same ceiling as a hand-typed ingredient: 5 kg."""

        assert shape.to_grams(6, "kg") is None


class TestGrounding:
    def test_a_decimal_comma_is_the_same_number(self):
        assert shape.is_grounded(8.5, "Сливочное масло — 8,5 г")

    def test_a_number_that_is_not_in_the_line_is_not_grounded(self):
        """«8,5» read as «85» is exactly the mistake this catches."""

        assert not shape.is_grounded(85, "Сливочное масло — 8,5 г")

    def test_a_line_without_a_source_is_never_grounded(self):
        line = shape.build_line(
            source_lines=["Масло — 30 г"], line=None, name="Масло", hint=None, quantity=30, unit="g"
        )

        assert line["grams"] == 30.0
        assert line["grounded"] is False

    def test_a_grounded_line(self):
        line = shape.build_line(
            source_lines=["Масло — 30 г"], line=1, name="Масло", hint=None, quantity=30, unit="g"
        )

        assert line["grounded"] is True

    def test_a_line_number_outside_the_file_has_no_source(self):
        assert shape.source_line(["a", "b"], 3) == ""
        assert shape.source_line(["a", "b"], 0) == ""


class TestInstructions:
    def test_copied_from_the_file_by_range(self):
        lines = ["# Блюдо", "Приготовление:", "Смешать.", "", "Выпекать 12–15 минут."]

        assert shape.instructions_from(lines, 3, 5) == "Смешать.\nВыпекать 12–15 минут."

    def test_a_broken_range_gives_nothing(self):
        assert shape.instructions_from(["a"], 2, 1) == ""
        assert shape.instructions_from(["a"], None, 1) == ""


class TestChunks:
    def test_bounded_by_lines(self):
        lines = ["x"] * 200

        assert shape.chunk_end(lines, 0, max_lines=90, max_chars=10_000) == 90
        assert shape.chunk_end(lines, 180, max_lines=90, max_chars=10_000) == 200

    def test_bounded_by_characters(self):
        lines = ["x" * 100] * 50

        assert shape.chunk_end(lines, 0, max_lines=90, max_chars=1000) == 9

    def test_one_over_long_line_is_still_taken(self):
        """Otherwise the parser would stand on that line for good."""

        assert shape.chunk_end(["x" * 5000, "y"], 0, max_lines=90, max_chars=1000) == 1


class TestNames:
    def test_spelling_noise_is_ignored(self):
        assert alias_key("  Масло   сливочное. ") == alias_key("масло сливочное")

    def test_what_distinguishes_products_is_kept(self):
        assert alias_key("Сливки 10%") != alias_key("Сливки 33%")

    def test_names_of_open_recipes_only(self):
        payload = shape.new_payload()
        done = shape.build_recipe(
            title="Готово",
            category=None,
            servings=None,
            instructions="",
            lines=[
                shape.build_line(
                    source_lines=[], line=None, name="Яйцо", hint=None, quantity=None, unit=None
                )
            ],
        )
        done["state"] = shape.IMPORTED
        waiting = shape.build_recipe(
            title="Ждёт",
            category=None,
            servings=None,
            instructions="",
            lines=[
                shape.build_line(
                    source_lines=[], line=None, name="Масло", hint=None, quantity=None, unit=None
                )
            ],
        )
        payload["recipes"] = [done, waiting]

        assert shape.name_keys(payload) == ["масло"]

    def test_servings_default_to_one(self):
        recipe = shape.build_recipe(
            title="Блюдо", category=None, servings=None, instructions="", lines=[]
        )

        assert recipe["servings"] == 1
