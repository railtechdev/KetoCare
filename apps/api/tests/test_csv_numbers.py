"""Число из ячейки CSV (`api.services.csv_numbers`) — без базы."""

from __future__ import annotations

import pytest

from api.services.csv_numbers import parse_decimal


class TestAccepted:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("81.1", 81.1),
            ("81,1", 81.1),
            (" 5 ", 5.0),
            ("0", 0.0),
            ("5.", 5.0),
            (".5", 0.5),
            ("-1", -1.0),
            ("100.09", 100.09),
        ],
    )
    def test_table_decimals(self, raw: str, expected: float) -> None:
        assert parse_decimal(raw) == expected


class TestRejected:
    @pytest.mark.parametrize(
        "raw",
        [
            "nan",
            "NaN",
            "inf",
            "-inf",
            "Infinity",
            "1e2",
            "1E-3",
            "1_00",
            "8_1",
            "+5",
            "",
            " ",
            "1.2.3",
            "1,2,3",
            "12 г",
            "0x10",
            "５",
            "1٥",
        ],
    )
    def test_what_float_would_take_but_a_table_would_not_write(self, raw: str) -> None:
        """«1_00» — это 100 для `float` и опечатка для человека."""

        assert parse_decimal(raw) is None

    def test_digits_overflowing_to_infinity(self) -> None:
        assert parse_decimal("9" * 400) is None
