"""CSV-импорт продуктов: построчный отчёт об ошибках (раздел 8.3 ТЗ).

Продукты — источник данных для расчёта диеты, поэтому импорт обязан отсекать
физиологически невозможные значения, а не записывать их молча.
"""

from __future__ import annotations

from pathlib import Path

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
        assert row.line == 2, "данные начинаются со 2-й строки (1-я — заголовок)"
        assert row.values["name_ru"] == "Масло сливочное"
        assert row.values["fat_100g"] == 81.1
        assert row.values["verified_at"].isoformat() == "2026-01-01"

    def test_comma_decimal_separator_accepted(self) -> None:
        """Excel в русской локали пишет дробную часть через запятую; чтобы запятая
        не спорила с разделителем колонок, такие поля он заключает в кавычки."""
        report = parse_csv(_csv('Творог,Молочное,121,"5,0",17.0,"1,8",0,USDA,SR28,2026-01-01'))
        assert report.ok, report.errors
        assert report.valid_rows[0].values["fat_100g"] == 5.0
        assert report.valid_rows[0].values["carbs_100g"] == 1.8

    def test_utf8_bom_handled(self) -> None:
        content = _csv(GOOD_ROW).decode("utf-8").encode("utf-8-sig")
        assert parse_csv(content).ok

    def test_optional_columns_absent(self) -> None:
        report = parse_csv(_csv(GOOD_ROW))
        assert report.valid_rows[0].values["name_uz"] is None


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

    def test_rounding_of_the_source_is_tolerated(self) -> None:
        """Сумма чуть больше 100 г — округление источника, а не ошибка ввода.

        Льняное масло в USDA (fdc 167702): жиры 99,98 г, белки 0,11 г — в сумме
        100,09. Каждый нутриент источник округлил отдельно, и строка блокировала
        загрузку всего файла. Ответ клиники на вопрос 27: допуск допустим.
        """

        report = parse_csv(_csv("Масло льняное,Жиры,884,99.98,0.11,0,0,USDA,SR28,2026-09-11"))
        assert report.ok, report.errors

    def test_the_tolerance_is_half_a_gram_inclusive(self) -> None:
        """100,5 г проходит, 100,6 г — уже нет.

        Слагаемые подобраны так, что в двоичной арифметике их сумма выходит
        100.50000000000001: без округления перед сравнением граница зависела бы
        от того, какими числами набрана сумма, и ровно 100,5 отклонялось бы.
        """

        assert 99.01 + 0.12 + 1.37 > 100.5, "подбор слагаемых перестал проверять округление"

        at_limit = parse_csv(_csv("Т,Жиры,880,99.01,0.12,1.37,0,USDA,SR28,2026-01-01"))
        over_limit = parse_csv(_csv("Т,Жиры,880,99.01,0.12,1.47,0,USDA,SR28,2026-01-01"))

        assert at_limit.ok, at_limit.errors
        assert not over_limit.ok
        assert any("превышает 100" in e.message for e in over_limit.errors), over_limit.errors

    @pytest.mark.parametrize("value", ["nan", "NaN", "inf", "-inf", "1e2", "1_00", "8_1"])
    def test_non_finite_numbers_rejected(self, value: str) -> None:
        """«nan», «1e2», «1_00» — числа для `float`, но не для таблицы составов.

        «1_00» молча становилось 100, «8_1» — 81: опечатка в ячейке превращалась
        в другое число без единого слова.

        NaN не проходит ни одно сравнение, поэтому ни граница поля, ни проверка
        суммы его не ловили: строка с жирами «nan» проходила импорт без ошибок.
        """

        report = parse_csv(_csv(f"Т,Жиры,700,{value},1,1,0,USDA,SR28,2026-01-01"))
        assert not report.ok
        assert any(e.column == "fat_100g" for e in report.errors), report.errors

    def test_a_single_field_gets_no_tolerance(self) -> None:
        """Допуск — у суммы, а не у отдельного поля: 100,3 г жира на 100 г
        продукта — не округление, а ошибка."""

        report = parse_csv(_csv("Т,Жиры,900,100.3,0,0,0,USDA,SR28,2026-01-01"))
        assert not report.ok
        assert any(e.column == "fat_100g" for e in report.errors), report.errors

    def test_fiber_greater_than_carbs_rejected(self) -> None:
        """Клетчатка — часть углеводов; fiber > carbs завысил бы соотношение.

        Знаменатель соотношения — чистые углеводы, и ядро не даёт вкладу
        продукта уйти в минус (ADR-0030). Но полагаться на это ядро не должно:
        строка, где клетчатки больше углеводов, — испорченный источник данных.
        """
        report = parse_csv(_csv("Т,Овощи,50,1,2,5,9,USDA,SR28,2026-01-01"))
        assert not report.ok
        assert any("Клетчатка" in e.message for e in report.errors), report.errors

    def test_multiple_errors_in_one_row_all_reported(self) -> None:
        report = parse_csv(_csv(",Жиры,x,y,1,1,0,USDA,SR28,bad-date"))
        columns = {e.column for e in report.errors}
        assert {"name_ru", "kcal_100g", "fat_100g", "verified_at"} <= columns


class TestDuplicatesWithinFile:
    """Одно название дважды в одном файле — тоже дубль: две записи с одним именем
    и разными значениями создают риск выбрать «не тот» продукт при расчёте меню."""

    def test_same_name_twice_reported(self) -> None:
        report = parse_csv(
            _csv(
                "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01",
                "Курица,Мясо,165,3.6,31,0,0,USDA,SR28,2026-01-01",
                "Масло,Жиры,900,99,0,0,0,Другой,v2,2026-01-01",
            )
        )
        assert len(report.valid_rows) == 2, "вторая запись с тем же именем отбрасывается"
        assert any("уже встречается в строке 2" in e.message for e in report.errors), report.errors

    def test_duplicate_detection_is_case_insensitive(self) -> None:
        report = parse_csv(
            _csv(
                "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01",
                "масло,Жиры,700,80,1,0,0,USDA,SR28,2026-01-01",
            )
        )
        assert len(report.valid_rows) == 1
        assert report.errors


class TestLineNumbersWithGaps:
    def test_duplicate_line_number_correct_after_invalid_rows(self) -> None:
        """valid_rows не сплошной: строки с ошибками в него не попадают. Номер
        строки должен браться из самой строки, а не из позиции в списке."""
        report = parse_csv(
            _csv(
                "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01",  # строка 2
                "Плохой,Жиры,нечисло,1,1,1,0,USDA,SR28,2026-01-01",  # строка 3 — ошибка
                "Курица,Мясо,165,3.6,31,0,0,USDA,SR28,2026-01-01",  # строка 4
            )
        )
        lines = [row.line for row in report.valid_rows]
        assert lines == [2, 4], f"номера строк должны быть реальными, получено {lines}"


class TestFieldLengthsAreCheckedInPreview:
    """Предел длины — тот же, что в схеме БД (`String(255)`).

    Разбор его не проверял: строка с длинным названием проходила превью без
    единого замечания, а на самом импорте база отвечала отказом — то есть 500
    и непонятно на какой строке. Превью, обещающее успех и не выполняющее
    обещание, хуже отсутствия превью.
    """

    def test_long_name_is_a_row_error_not_a_server_error(self) -> None:
        long_name = "М" * 256
        report = parse_csv(_csv(f"{long_name},Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01"))

        assert not report.ok
        assert any(
            error.column == "name_ru" and "256" in error.message for error in report.errors
        ), report.errors

    def test_long_source_is_caught_too(self) -> None:
        """Отказ базы одинаков для любой длинной колонки, а не только названия."""

        report = parse_csv(_csv(f"Масло,Жиры,717,81.1,0.9,0.1,0,{'U' * 256},SR28,2026-01-01"))

        assert not report.ok
        assert any(error.column == "source" for error in report.errors), report.errors

    def test_exactly_at_the_limit_is_accepted(self) -> None:
        report = parse_csv(_csv(f"{'М' * 255},Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01"))

        assert report.ok, report.errors


class TestSeedFile:
    def test_seed_file_imports_cleanly(self) -> None:
        """Стартовая база продуктов проходит импорт без единой ошибки.

        `infra/seed/README.md` обещал «прогнан парсером: ноль ошибок», но
        держалось это только на словах. Правка правил импорта, отклоняющая
        строку стартовой базы, теперь падает здесь, а не у администратора
        клиники, — так льняное масло и выпадало из файла до вопроса 27.
        """

        seed = Path(__file__).resolve().parents[3] / "infra" / "seed" / "products-usda.csv"
        report = parse_csv(seed.read_bytes())

        assert report.ok, report.errors[:5]
        assert report.total_rows == 99
        assert "Масло льняное" in {row.values["name_ru"] for row in report.valid_rows}

    def test_kindergarten_standard_file_imports_cleanly(self) -> None:
        """Таблица стандарта детсадовских меню годится для импорта (ADR-0055)."""

        table = (
            Path(__file__).resolve().parents[3] / "infra" / "seed" / "dmtt-2025" / "products.csv"
        )
        report = parse_csv(table.read_bytes())

        assert report.ok, report.errors[:5]
        assert report.total_rows == 36

    def test_source_files_import_into_reference_standards(self) -> None:
        """Файлы источников (ADR-0067, `docs/import/sources`) грузятся в справочник-источник.

        Минздрав РУз — с прочерками (34 в углеводах, 8 в жирах, клетчатки нет
        вовсе); в рабочий справочник такой файл не пройдёт. USDA связывается с
        Минздравом по названию: каждое название USDA есть в файле Минздрава.
        """

        sources = Path(__file__).resolve().parents[3] / "docs" / "import" / "sources"
        mz = parse_csv((sources / "mz-ruz.csv").read_bytes(), allow_unknown=True)
        usda = parse_csv((sources / "usda-sr-legacy.csv").read_bytes(), allow_unknown=True)

        assert mz.ok, mz.errors[:5]
        assert usda.ok, usda.errors[:5]
        assert mz.total_rows == 77
        unknown = [field for row in mz.valid_rows for field in row.values["unknown_fields"]]
        assert unknown.count("carbs_100g") == 34
        assert unknown.count("fat_100g") == 8
        assert unknown.count("fiber_100g") == 77
        assert not parse_csv((sources / "mz-ruz.csv").read_bytes()).ok
        mz_names = {row.values["name_ru"] for row in mz.valid_rows}
        assert {row.values["name_ru"] for row in usda.valid_rows} <= mz_names


class TestUnknownValues:
    """Прочерк источника — пустая ячейка, только для справочника-источника (ADR-0067)."""

    ROW = "Говядина,Белковые,218,7,18.9,,,МЗ РУз,действующая редакция,2026-11-11"

    def test_empty_value_is_an_error_by_default(self) -> None:
        report = parse_csv(_csv(self.ROW))
        assert {e.column for e in report.errors} == {"carbs_100g", "fiber_100g"}

    def test_reference_records_unknown_as_zero(self) -> None:
        report = parse_csv(_csv(self.ROW), allow_unknown=True)
        assert report.ok, report.errors
        values = report.valid_rows[0].values
        assert values["unknown_fields"] == ["carbs_100g", "fiber_100g"]
        assert values["carbs_100g"] == 0.0

    def test_kcal_is_never_unknown(self) -> None:
        report = parse_csv(
            _csv("Говядина,Белковые,,7,18.9,0,0,МЗ РУз,1,2026-11-11"), allow_unknown=True
        )
        assert [e.column for e in report.errors] == ["kcal_100g"]

    def test_fiber_over_unknown_carbs_is_not_compared(self) -> None:
        report = parse_csv(_csv("Лук,Овощи,20,0.1,1,,2,МЗ РУз,1,2026-11-11"), allow_unknown=True)
        assert report.ok, report.errors

    def test_known_values_have_empty_unknown_list(self) -> None:
        assert parse_csv(_csv(GOOD_ROW)).valid_rows[0].values["unknown_fields"] == []


class TestWaste:
    HEADER_W = HEADER + ",waste_pct"

    def _csv(self, waste: str) -> bytes:
        return f"{self.HEADER_W}\n{GOOD_ROW},{waste}\n".encode()

    def test_waste_parsed(self) -> None:
        report = parse_csv(self._csv('"25,5"'))
        assert report.ok, report.errors
        assert report.valid_rows[0].values["waste_pct"] == 25.5

    def test_empty_waste_is_not_set(self) -> None:
        report = parse_csv(self._csv(""))
        assert "waste_pct" not in report.valid_rows[0].values

    @pytest.mark.parametrize("waste", ["-1", "100", "много"])
    def test_bad_waste_rejected(self, waste: str) -> None:
        report = parse_csv(self._csv(waste))
        assert [e.column for e in report.errors] == ["waste_pct"]
