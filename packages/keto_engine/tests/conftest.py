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

#: Сколько примеров перебирать. Глубина повышает ВЕРОЯТНОСТЬ находки и ничего
#: не гарантирует — это измерено на дефекте из PR #203 (соотношение зависело от
#: массы навески) повторными прогонами с разными сидами: 1000 примеров не нашли
#: его ни разу из пяти, 5000 — один раз, 20000 — дважды, 50000 — дважды из трёх.
#: Порога, за которым «находится всегда», у случайного поиска не существует.
#:
#: Отсюда умеренная глубина на каждый прогон: 50000 примеров стоят на раннере
#: почти двенадцать минут (и ещё столько же в общей задаче pytest, которая
#: гоняет те же тесты), покупая две трети шанса. Глубокий поиск уместен ночным
#: прогоном, а не на каждом пуше.
#:
#: Постоянную защиту даёт не перебор, а явный тест на найденный вход: для #203
#: это `TestDegenerateNetCarbs` в `test_engine_internals.py`.
_LOCAL_EXAMPLES = 1000
_CI_EXAMPLES = 5000

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
