import os
import sys
from pathlib import Path

import pytest
from hypothesis import HealthCheck, settings
from hypothesis.database import DirectoryBasedExampleDatabase

sys.path.insert(0, str(Path(__file__).parent))

from reference_cases_path import REFERENCE_CASES_DIR  # noqa: E402

#: База найденных property-тестами примеров лежит В РЕПОЗИТОРИИ, а не в рабочем
#: `.hypothesis/` каждой машины.
#:
#: Причина — находка PR #203: property-тест нашёл вход, на котором соотношение
#: зависело от массы навески, но воспроизводился он только там, где выпал. В CI
#: тот же тест был зелёным — hypothesis просто не наткнулся на то же значение.
#:
#: Что это даёт и чего НЕ даёт (измерено, а не предположено): пока дефект жив,
#: найденный вход лежит здесь файлом, и его можно закоммитить в ветку — тогда
#: он воспроизводится у всех мгновенно, без глубокого перебора (2 секунды
#: против двух минут). Но как только тест снова зелёный, hypothesis свою запись
#: УДАЛЯЕТ, и в норме каталог пуст. Постоянную защиту даёт не база, а явный
#: тест на найденный вход — для #203 это `TestDegenerateNetCarbs`.
EXAMPLE_DATABASE_DIR = Path(__file__).parent / "example-database"

#: Сколько примеров перебирать. Числа измерены, а не взяты на глаз: дефект,
#: найденный в PR #203 (соотношение зависело от массы навески), не находится ни
#: на 500, ни на 5000, ни на 20000 примеров и воспроизводится на 50000 —
#: 17,8 секунды против 0,8 у нынешнего прогона.
#:
#: Отсюда два режима: на своей машине цикл правки остаётся быстрым (2,8 с), в
#: CI ядро гоняется отдельной задачей и ищет глубоко — 130 секунд. Это плата за
#: то, что класс дефекта ловится перебором, а не удачей; найденное закрепляется
#: явным тестом, и дальше проверяется уже мгновенно.
_LOCAL_EXAMPLES = 1000
_CI_EXAMPLES = 50000

settings.register_profile(
    "keto-engine",
    database=DirectoryBasedExampleDatabase(EXAMPLE_DATABASE_DIR),
    max_examples=_LOCAL_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.register_profile(
    "keto-engine-ci",
    database=DirectoryBasedExampleDatabase(EXAMPLE_DATABASE_DIR),
    max_examples=_CI_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.load_profile("keto-engine-ci" if os.environ.get("CI") else "keto-engine")


@pytest.fixture(scope="session")
def reference_cases_dir() -> Path:
    return REFERENCE_CASES_DIR
