"""CSV-импорт продуктов: построчный отчёт об ошибках (раздел 8.3 ТЗ).

Продукты — источник данных для расчёта диеты, поэтому импорт обязан отсекать
физиологически невозможные значения, а не записывать их молча.
"""

from __future__ import annotations

import pytest

from api.services.product_import import parse_csv

HEADER = (
    "name_ru,category,kcal_100g,fat_100g,protein_100g,carbs_100g,fiber_100g,"
    "source,source_version,verified_at"
)
GOOD_ROW = "Масло сливочное,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01"


def _csv(*rows: str) -> bytes:
    return ("\n".join([HEADER, *rows]) + "\n").encode("utf-8")


class TestValidFiles:
    def test_valid_row_parsed(self) -> None:
        report = parse_csv(_csv(GOOD_ROW))
        assert report.ok, report.errors
        assert report.total_rows == 1
        row = report.valid_rows[0]
        assert row["name_ru"] == "Масло сливочное"
        assert row["fat_100g"] == 81.1
        assert row["verified_at"].isoformat() == "2026-01-01"

    def test_comma_decimal_separator_accepted(self) -> None:
        """Excel в русской локали пишет дробную часть через запятую; чтобы запятая
        не спорила с разделителем колонок, такие поля он заключает в кавычки."""
        report = parse_csv(_csv('Творог,Молочное,121,"5,0",17.0,"1,8",0,USDA,SR28,2026-01-01'))
        assert report.ok, report.errors
        assert report.valid_rows[0]["fat_100g"] == 5.0
        assert report.valid_rows[0]["carbs_100g"] == 1.8

    def test_utf8_bom_handled(self) -> None:
        content = _csv(GOOD_ROW).decode("utf-8").encode("utf-8-sig")
        assert parse_csv(content).ok

    def test_optional_columns_absent(self) -> None:
        report = parse_csv(_csv(GOOD_ROW))
        assert report.valid_rows[0]["name_uz"] is None


class TestStructuralErrors:
    def test_missing_required_column_reported(self) -> None:
        header = HEADER.replace(",fat_100g", "")
        report = parse_csv((header + "\n").encode())
        assert not report.ok
        assert "fat_100g" in report.errors[0].message

    def test_empty_file_reported(self) -> None:
        assert not parse_csv(b"").ok

    def test_header_only_reported(self) -> None:
        report = parse_csv((HEADER + "\n").encode())
        assert not report.ok
        assert "нет строк" in report.errors[0].message.lower()

    def test_non_utf8_reported(self) -> None:
        report = parse_csv("Масло".encode("cp1251"))
        assert not report.ok
        assert "UTF-8" in report.errors[0].message


class TestRowValidation:
    def test_error_reports_line_number(self) -> None:
        report = parse_csv(_csv(GOOD_ROW, "Плохой,Жиры,нечисло,1,1,1,0,USDA,SR28,2026-01-01"))
        assert not report.ok
        assert report.errors[0].line == 3, "строка 1 — заголовок, данные начинаются со 2-й"
        assert report.errors[0].column == "kcal_100g"

    def test_valid_rows_still_collected_alongside_errors(self) -> None:
        report = parse_csv(_csv(GOOD_ROW, "Плохой,Жиры,x,1,1,1,0,USDA,SR28,2026-01-01"))
        assert len(report.valid_rows) == 1
        assert len(report.errors) == 1

    @pytest.mark.parametrize(
        "row,expect_in_message",
        [
            ("Т,Жиры,-5,1,1,1,0,USDA,SR28,2026-01-01", "отрицательным"),
            ("Т,Жиры,99999,1,1,1,0,USDA,SR28,2026-01-01", "превышает"),
            ("Т,Жиры,100,150,1,1,0,USDA,SR28,2026-01-01", "превышает"),
            ("Т,Жиры,100,1,1,1,0,USDA,SR28,01-01-2026", "ГГГГ-ММ-ДД"),
            (",Жиры,100,1,1,1,0,USDA,SR28,2026-01-01", "Название обязательно"),
            ("Т,,100,1,1,1,0,USDA,SR28,2026-01-01", "обязательно"),
        ],
    )
    def test_invalid_values_rejected(self, row: str, expect_in_message: str) -> None:
        report = parse_csv(_csv(row))
        assert not report.ok
        assert any(expect_in_message in e.message for e in report.errors), report.errors

    def test_macros_over_100g_rejected(self) -> None:
        """Сумма Ж+Б+У больше 100 г на 100 г продукта физически невозможна —
        такие значения исказили бы расчёт кетосоотношения."""
        report = parse_csv(_csv("Т,Жиры,900,60,30,30,0,USDA,SR28,2026-01-01"))
        assert not report.ok
        assert any("превышает 100" in e.message for e in report.errors), report.errors

    def test_fiber_greater_than_carbs_rejected(self) -> None:
        """Клетчатка — часть углеводов; fiber > carbs сломал бы режим net_carbs."""
        report = parse_csv(_csv("Т,Овощи,50,1,2,5,9,USDA,SR28,2026-01-01"))
        assert not report.ok
        assert any("Клетчатка" in e.message for e in report.errors), report.errors

    def test_multiple_errors_in_one_row_all_reported(self) -> None:
        report = parse_csv(_csv(",Жиры,x,y,1,1,0,USDA,SR28,bad-date"))
        columns = {e.column for e in report.errors}
        assert {"name_ru", "kcal_100g", "fat_100g", "verified_at"} <= columns
