"""Защита нагрузочного профиля от чужой цели.

Профиль ПИШЕТ записи в дневник: на стенде это записи живой семьи, и убрать их
можно только `core.tools.erase_patient`. Прежде здесь стояла печать
«ВНИМАНИЕ: цель похожа на настоящий стенд», после которой прогон продолжался, —
правило существовало в тексте и ни в одном исполняемом виде.
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

_LOAD = Path(__file__).resolve().parents[1] / "load"
_GUARD = _LOAD / "target_guard.py"
_PROFILE = _LOAD / "locustfile.py"


def _load():  # type: ignore[no-untyped-def]
    spec = importlib.util.spec_from_file_location("load_target_guard", _GUARD)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


PROFILE = _load()

LOCAL = "http://localhost:5175"
STAND = "https://app.railtech.uz"


@pytest.fixture(autouse=True)
def _no_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(PROFILE.ALLOW_TARGET, raising=False)


@pytest.mark.parametrize(
    "target",
    [
        LOCAL,
        "http://127.0.0.1:8001",
        # Локальный TLS: прежняя редакция отвергала его ложно — она смотрела на
        # схему, а не на хост.
        "https://localhost:8443",
        "http://[::1]:8001",
        # Верхний регистр В ЛОКАЛЬНОЙ цели: без приведения хоста к нижнему
        # регистру она не совпала бы с белым списком и была бы отвергнута.
        # Прежняя проверка регистра стояла на ЧУЖОЙ цели и ничего не ловила:
        # та отвергается и так (замечание по мутации, PR #198).
        "HTTP://LOCALHOST:5175",
        # Пустая цель — «не задана»: locust и так никуда не пойдёт, а отказ был
        # бы про не тот предмет.
        "",
    ],
)
def test_local_targets_pass(target: str) -> None:
    PROFILE.refuse_foreign_target(target)


@pytest.mark.parametrize(
    ("target", "why"),
    [
        (STAND, "домен стенда"),
        # Эти три проходили мимо прежней редакции: она искала «railtech» и
        # `https://`, а стенд бывает и по http, и по имени, и по адресу.
        ("http://prod-api.internal:8001", "чужое имя без TLS"),
        ("http://89.23.117.4:8001", "адрес вместо имени"),
        ("http://app.ketocare.railtech.uz", "домен стенда по http"),
        # Регистр: `startswith` и `in` его различали, хост — нет.
        ("HTTPS://APP.EXAMPLE.COM", "верхний регистр"),
        # Без схемы `urlsplit` разбирает строку как «схема:путь» и хоста не даёт
        # вовсе — без подстановки схемы чужая цель выглядела бы локальной.
        ("app.example.com:8001", "адрес без схемы"),
    ],
)
def test_foreign_targets_are_refused(target: str, why: str) -> None:
    with pytest.raises(RuntimeError) as refusal:
        PROFILE.refuse_foreign_target(target)
    # Отказ обязан называть цену: записи в дневнике живой семьи.
    assert "дневник" in str(refusal.value), why
    assert PROFILE.ALLOW_TARGET in str(refusal.value), why


def test_permission_names_the_target(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(PROFILE.ALLOW_TARGET, "1")
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target(STAND)

    monkeypatch.setenv(PROFILE.ALLOW_TARGET, "https://other.example.com")
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target(STAND)

    monkeypatch.setenv(PROFILE.ALLOW_TARGET, STAND)
    PROFILE.refuse_foreign_target(STAND)


def test_trailing_slash_does_not_bypass_the_ban(monkeypatch: pytest.MonkeyPatch) -> None:
    # `https://app.railtech.uz/` — та же цель; без нормализации разрешение не
    # сошлось бы, а запрет обходился бы косой чертой.
    monkeypatch.setenv(PROFILE.ALLOW_TARGET, STAND)
    PROFILE.refuse_foreign_target(STAND + "/")


def _prepare_node() -> ast.FunctionDef:
    tree = ast.parse(_PROFILE.read_text(encoding="utf8"))
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_prepare"
    )


def test_guard_is_wired_as_a_start_listener() -> None:
    """Подготовка прогона обязана быть ПОДПИСАНА на старт.

    Без декоратора функция просто не вызывается — прогон идёт на чужую цель без
    единого слова отказа, и прежний тест этого не ловил: он искал подстроку
    вызова, а она остаётся на месте (замечание ревью PR #198, доказано живым
    прогоном locust).
    """
    decorators = [ast.dump(node) for node in _prepare_node().decorator_list]
    assert any("test_start" in node and "add_listener" in node for node in decorators)


def test_guard_runs_before_any_network_call() -> None:
    """Отказ обязан случиться ДО входа, а не после.

    Перенос блока за `requests.post` оставлял тесты зелёными, но профиль успевал
    сходить на стенд: запись в его `audit_log` и трата лимита `5/мин`.
    """
    body = _prepare_node().body
    host_names = {
        target.id
        for statement in body
        if isinstance(statement, ast.Assign)
        for target in statement.targets
        if isinstance(target, ast.Name)
    }

    guard_at: int | None = None
    network_at: int | None = None
    for index, statement in enumerate(body):
        dumped = ast.dump(statement)
        if guard_at is None and "refuse_foreign_target" in dumped:
            guard_at = index
            # Аргумент — то самое имя, в которое положен `environment.host`:
            # `refuse_foreign_target("")` выключал бы защиту, оставляя вызов.
            call = next(
                node
                for node in ast.walk(statement)
                if isinstance(node, ast.Call)
                and getattr(node.func, "id", "") == "refuse_foreign_target"
            )
            assert len(call.args) == 1
            assert isinstance(call.args[0], ast.Name)
            assert call.args[0].id in host_names
        if network_at is None and "requests" in dumped:
            network_at = index

    assert guard_at is not None, "вызов защиты не найден в теле `_prepare`"
    if network_at is not None:
        assert guard_at < network_at, "защита стоит после обращения к сети"


def test_refusal_is_reraised_as_stop_test() -> None:
    """Отказ обязан перевыбрасываться как `StopTest`.

    locust ловит исключения обработчиков и продолжает прогон; `StopTest` он
    пропускает наружу специально. Прежняя проверка искала подстроку — и
    оставалась зелёной, если отказ проглотить (тот же класс, что PR и лечит).
    """
    raises = [
        node
        for statement in _prepare_node().body
        if isinstance(statement, ast.Try)
        for handler in statement.handlers
        for node in ast.walk(handler)
        if isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and getattr(node.exc.func, "id", "") == "StopTest"
    ]
    assert raises, "отказ не перевыбрасывается как StopTest"


def test_permission_must_equal_the_target(monkeypatch: pytest.MonkeyPatch) -> None:
    # Разрешение сравнивается ЦЕЛИКОМ: при сравнении по вхождению
    # `LOAD_ALLOW_TARGET=uz` открыл бы любой адрес в этой зоне.
    monkeypatch.setenv(PROFILE.ALLOW_TARGET, "uz")
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target(STAND)


def test_unparsable_target_is_refused() -> None:
    # Пустой хост разрешён только для буквально пустой цели: `//evil.com` хоста
    # не даёт, и прежняя редакция пропускала такую строку — fail-open.
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target("//evil.com")
