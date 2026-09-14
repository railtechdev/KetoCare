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


def test_guard_is_called_by_the_profile() -> None:
    """Защита обязана быть ВЫЗВАНА профилем, а не просто объявлена.

    Проверка по исходнику, а не выполнением: `locustfile.py` импортирует
    `locust` и `requests`, которых нет в общем окружении. Но искать ПОДСТРОКУ
    мало — так тест оставался зелёным при закомментированном вызове и при
    `if False:` (замечание ревью PR #198). Поэтому разбирается дерево: вызов
    обязан стоять выражением прямо в теле `_prepare` или в его `try`.
    """
    tree = ast.parse(_PROFILE.read_text(encoding="utf8"))
    prepare = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_prepare"
    )

    def reachable(body: list[ast.stmt]) -> list[ast.stmt]:
        out: list[ast.stmt] = []
        for statement in body:
            out.append(statement)
            if isinstance(statement, ast.Try):
                out.extend(statement.body)
        return out

    calls = [
        statement
        for statement in reachable(prepare.body)
        if isinstance(statement, ast.Expr)
        and isinstance(statement.value, ast.Call)
        and getattr(statement.value.func, "id", "") == "refuse_foreign_target"
    ]
    assert calls, "вызов защиты не стоит в теле `_prepare`"


def test_refusal_stops_the_run() -> None:
    """Отказ обязан ОСТАНАВЛИВАТЬ прогон, а не печататься в журнал.

    locust ловит исключения обработчиков событий и продолжает работу, кроме
    `StopTest` и родственных: ревью PR #198 показало настоящим прогоном, что
    пользователи поднимались и после отказа. Поэтому профиль обязан
    перевыбрасывать отказ как `StopTest`.
    """
    source = _PROFILE.read_text(encoding="utf8")
    assert "from locust.exception import StopTest" in source
    assert "raise StopTest(" in source
