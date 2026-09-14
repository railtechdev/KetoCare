import os
import sys
from pathlib import Path

import pytest
from hypothesis import is_hypothesis_test, settings
from hypothesis.database import DirectoryBasedExampleDatabase

sys.path.insert(0, str(Path(__file__).parent))

from reference_cases_path import REFERENCE_CASES_DIR  # noqa: E402


@pytest.fixture(scope="session")
def reference_cases_dir() -> Path:
    return REFERENCE_CASES_DIR


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
#:
#: Три режима: быстрый локальный, умеренный на каждый пуш и глубокий ночной —
#: 50000 примеров стоят на раннере почти двенадцать минут, и платить их на
#: каждом пуше ради двух третей шанса не стоит (#210).
#:
#: Постоянную защиту даёт не перебор, а явный тест на найденный вход: для #203
#: это `TestDegenerateNetCarbs` в `test_engine_internals.py`.
_EXAMPLES = {
    "local": 1000,
    "ci": 5000,
    "deep": 50000,
}


def _profile_name() -> str:
    if os.environ.get("KETO_ENGINE_DEEP"):
        return "deep"
    return "ci" if os.environ.get("CI") else "local"


for _name, _examples in _EXAMPLES.items():
    settings.register_profile(
        f"keto-engine-{_name}",
        database=DirectoryBasedExampleDatabase(EXAMPLE_DATABASE_DIR),
        max_examples=_examples,
    )


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Профиль вешается на тесты ЯДРА, а не на весь процесс.

    `settings.load_profile` действовал бы на любой hypothesis-тест в прогоне —
    в том числе на будущие тесты других пакетов, которым глубина ядра ни к чему
    (#212). Поэтому профиль применяется точечно: к собранным здесь тестам, у
    которых нет собственных `@settings` (у теста решателя они есть, и они
    сильнее).

    Штатные проверки на медленный пример (`deadline`, `HealthCheck.too_slow`)
    НЕ снимаются (#213): при глубоком переборе они срабатывали, но это сигнал о
    входе, который считается неприлично долго, а не помеха.
    """
    profile = settings.get_profile(f"keto-engine-{_profile_name()}")
    tests_dir = Path(__file__).parent
    for item in items:
        if not str(item.fspath).startswith(str(tests_dir)):
            continue
        test = getattr(item, "obj", None)
        if test is None or not is_hypothesis_test(test):
            continue
        # Явный `@settings` помечает функцию `_hypothesis_internal_settings_applied`;
        # у голого `@given` атрибута нет, хотя настройки по умолчанию он тоже
        # вешает — по ним явное от неявного не отличить.
        if getattr(test, "_hypothesis_internal_settings_applied", False):
            continue
        item.obj = settings(profile)(test)
