"""Z-баллы ВОЗ (вопрос 15): сверка с опубликованными значениями ВОЗ.

Модуль считает по столбцам L, M, S. Ожидаемые числа ниже взяты из ДРУГИХ
столбцов тех же официальных таблиц ВОЗ — SD4neg … SD4, то есть измерений,
которые ВОЗ сама напечатала для z = −4 … +4 (файлы и контрольные суммы —
`core/growth/data/README.txt`). Значения в таблицах ВОЗ округлены до трёх
знаков, отсюда допуск: 0,01 SD.

Базы данных тесты не требуют.
"""

from __future__ import annotations

import pytest

from core.growth import who

TOL = 0.01


@pytest.mark.parametrize(
    ("indicator", "sex", "age_days", "value", "expected_z", "where"),
    [
        # WHO 2006, wfa-boys-zscore-expanded-tables.xlsx, Day 0
        ("wfa", "m", 0, 3.346, 0.0, "SD0"),
        ("wfa", "m", 0, 2.459, -2.0, "SD2neg"),
        ("wfa", "m", 0, 2.080, -3.0, "SD3neg"),
        ("wfa", "m", 0, 5.031, 3.0, "SD3"),
        # WHO 2006, wfa-girls-zscore-expanded-tables.xlsx, Day 0 / Day 1856
        ("wfa", "f", 0, 2.395, -2.0, "SD2neg"),
        ("wfa", "f", 1856, 25.190, 2.0, "SD2"),
        # WHO 2006, lhfa-boys/girls-zscore-expanded-tables.xlsx
        ("hfa", "m", 0, 46.098, -2.0, "SD2neg"),
        ("hfa", "m", 1856, 101.158, -2.0, "SD2neg"),
        ("hfa", "f", 1856, 124.308, 3.0, "SD3"),
        # WHO 2006, bfa-girls/boys-zscore-expanded-tables.xlsx
        ("bmi", "f", 1856, 16.905, 1.0, "SD1"),
        ("bmi", "m", 0, 11.133, -2.0, "SD2neg"),
        # WHO 2007, hfa-boys/girls-z-who-2007-exp.xlsx, Month 61 / 228
        ("hfa", "m", round(61 * who.DAYS_PER_MONTH), 101.082, -2.0, "SD2neg"),
        ("hfa", "m", round(228 * who.DAYS_PER_MONTH), 176.543, 0.0, "SD0"),
        ("hfa", "f", round(228 * who.DAYS_PER_MONTH), 150.073, -2.0, "SD2neg"),
        # WHO 2007, bmi-girls/boys-z-who-2007-exp.xlsx
        ("bmi", "f", round(228 * who.DAYS_PER_MONTH), 29.670, 2.0, "SD2"),
        ("bmi", "m", round(61 * who.DAYS_PER_MONTH), 13.031, -2.0, "SD2neg"),
        # WHO 2007, weight-for-age 5-10 years, Month 120
        ("wfa", "m", round(120 * who.DAYS_PER_MONTH), 23.206, -2.0, "SD2neg"),
        ("wfa", "f", round(120 * who.DAYS_PER_MONTH), 46.890, 2.0, "SD2"),
    ],
)
def test_matches_who_published_sd_values(
    indicator: who.Indicator,
    sex: who.SexCode,
    age_days: int,
    value: float,
    expected_z: float,
    where: str,
) -> None:
    z = who.zscore(indicator, sex, age_days, value)
    assert z is not None, where
    assert z == pytest.approx(expected_z, abs=TOL), where


@pytest.mark.parametrize(
    ("indicator", "sex", "age_days", "value", "expected_z"),
    [
        # Столбцы SD4 / SD4neg ВОЗ посчитаны ограниченным методом: шаг за
        # третьим SD равен расстоянию между 2 и 3 SD. Чистая LMS-формула дала бы
        # здесь другое число — это и проверяется.
        ("wfa", "m", 0, 5.642, 4.0),  # wfa-boys expanded, Day 0, SD4
        ("wfa", "m", 0, 1.701, -4.0),  # там же, SD4neg
        ("bmi", "f", 1856, 23.374, 4.0),  # bfa-girls expanded, Day 1856, SD4
        ("bmi", "f", round(228 * who.DAYS_PER_MONTH), 42.689, 4.0),  # bmi-girls 2007, Month 228
        ("wfa", "m", round(120 * who.DAYS_PER_MONTH), 67.829, 4.0),  # wfa-boys 2007, Month 120
    ],
)
def test_restricted_computation_beyond_three_sd(
    indicator: who.Indicator, sex: who.SexCode, age_days: int, value: float, expected_z: float
) -> None:
    z = who.zscore(indicator, sex, age_days, value)
    assert z is not None
    assert z == pytest.approx(expected_z, abs=TOL)

    p = who.lms_at(indicator, sex, age_days)
    assert p is not None
    plain = ((value / p.m) ** p.l - 1) / (p.l * p.s)
    assert abs(plain - expected_z) > TOL  # без ограничения было бы иначе


def test_height_is_not_restricted() -> None:
    # Для роста ВОЗ ограниченного расчёта не применяет: SD4 = M + 4·σ.
    # lhfa-boys expanded, Day 1856: SD4 = 129.175.
    z = who.zscore("hfa", "m", 1856, 129.175)
    assert z == pytest.approx(4.0, abs=TOL)


def test_median_is_zero_everywhere() -> None:
    for indicator in ("wfa", "hfa", "bmi"):
        for sex in ("m", "f"):
            for age_days in (0, 400, 1856, 1857, 2500, 3600):
                p = who.lms_at(indicator, sex, age_days)
                assert p is not None
                assert who.zscore(indicator, sex, age_days, p.m) == pytest.approx(0.0, abs=1e-9)


def test_switch_from_2006_to_2007_tables_is_continuous() -> None:
    # Последний день стандарта и первый день справочника: ребёнок не должен
    # «прыгнуть» по шкале за сутки. Таблицы ВОЗ на стыке расходятся слегка
    # (мальчики, рост: 110,50 см на 1856-й день и 110,26 см на 61-й месяц).
    for indicator, value in (("wfa", 18.0), ("hfa", 110.0), ("bmi", 15.5)):
        for sex in ("m", "f"):
            before = who.zscore(indicator, sex, who.LAST_STANDARD_DAY, value)
            after = who.zscore(indicator, sex, who.LAST_STANDARD_DAY + 1, value)
            assert before is not None and after is not None
            assert abs(before - after) < 0.1, (indicator, sex)


def test_between_months_parameters_are_interpolated() -> None:
    day_100 = round(100 * who.DAYS_PER_MONTH)
    lo = who.lms_at("hfa", "f", day_100)
    hi = who.lms_at("hfa", "f", round(101 * who.DAYS_PER_MONTH))
    mid = who.lms_at("hfa", "f", day_100 + 15)
    assert lo is not None and hi is not None and mid is not None
    assert lo.m < mid.m < hi.m


@pytest.mark.parametrize(
    ("indicator", "age_days", "value"),
    [
        ("wfa", round(121 * who.DAYS_PER_MONTH), 30.0),  # вес к возрасту — только до 10 лет
        ("hfa", round(229 * who.DAYS_PER_MONTH), 170.0),  # справочник — до 19 лет
        ("bmi", round(229 * who.DAYS_PER_MONTH), 20.0),
        ("hfa", -1, 50.0),
        ("wfa", 100, 0.0),
        ("bmi", 100, -3.0),
    ],
)
def test_outside_tables_is_none(indicator: who.Indicator, age_days: int, value: float) -> None:
    assert who.zscore(indicator, "m", age_days, value) is None


def test_wfa_is_defined_at_exactly_ten_years() -> None:
    assert who.zscore("wfa", "f", round(120 * who.DAYS_PER_MONTH), 31.8578) is not None


def test_percentile() -> None:
    assert who.percentile(0) == pytest.approx(50.0)
    assert who.percentile(-2) == pytest.approx(2.275, abs=0.001)
    assert who.percentile(1.881) == pytest.approx(97.0, abs=0.01)


def test_bmi() -> None:
    assert who.bmi(20.0, 100.0) == pytest.approx(20.0)


def test_significant_drop_is_one_sd_from_baseline() -> None:
    assert who.SIGNIFICANT_DROP_SD == 1.0
    assert who.significant_drop(0.5, -0.5)
    assert who.significant_drop(-0.3, -1.3)
    assert not who.significant_drop(0.5, -0.49)
    assert not who.significant_drop(-1.0, 0.5)  # рост z-балла — не снижение
