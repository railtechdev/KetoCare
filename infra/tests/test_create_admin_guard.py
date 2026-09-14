"""Проверка пароля у скрипта первого администратора.

У `create_admin.py` не было ни одного теста: ревью PR #200 показало, что его
проверку длины можно удалить целиком, не уронив ничего. При этом скрипт заводит
администратора клиники на публичном домене, а пароль приходит из секретов
репозитория — цена ошибки та же, что у демо-сида, где это уже под тестом.

Отказ идёт через `parser.error`, то есть `SystemExit` с кодом 2, и случается ДО
`asyncio.run(create_admin(...))`: ни базы, ни сети тесту не нужно.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from collections.abc import Coroutine
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "create_admin.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("create_admin_guard", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ADMIN = _load()
ARGV = ["--email", "admin@clinic.example", "--name", "Админ Клиники"]


@pytest.fixture(autouse=True)
def _no_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ADMIN.PASSWORD_ENV, raising=False)


def test_short_password_is_refused(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, "коротко")
    with pytest.raises(SystemExit) as refusal:
        ADMIN.main(ARGV)
    # `parser.error` выходит с кодом 2 и пишет причину в stderr.
    assert refusal.value.code == 2
    message = capsys.readouterr().err
    assert ADMIN.PASSWORD_ENV in message
    assert str(ADMIN.MIN_PASSWORD_LENGTH) in message
    assert "админка" in message


def _without_real_work(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Остановить скрипт сразу после проверок, не доходя до базы.

    Ловить любое исключение нельзя: такая проверка проходит и когда падает сам
    тест. Поэтому `asyncio.run` подменяется заглушкой — `main()` доходит до неё
    и возвращает управление, а утверждение становится прямым: отказа по длине
    не было.
    """
    reached: list[str] = []

    def _stop(coro: Coroutine[Any, Any, Any]) -> int:
        reached.append("работа")
        coro.close()
        return 0

    monkeypatch.setattr(ADMIN.asyncio, "run", _stop)
    return reached


def test_password_of_minimum_length_passes_the_length_check(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Граница: со строгим `<=` вместо `<` этот случай отвергался бы.
    reached = _without_real_work(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, "x" * ADMIN.MIN_PASSWORD_LENGTH)

    assert ADMIN.main(ARGV) == 0
    assert reached == ["работа"]
    assert "короче" not in capsys.readouterr().err


def test_absent_password_is_not_checked_for_length(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Без переменной пароль генерируется, и проверять его длину нечего: правило
    # о человеческом пароле не должно мешать обычному пути.
    reached = _without_real_work(monkeypatch)

    assert ADMIN.main(ARGV) == 0
    assert reached == ["работа"]
    assert "короче" not in capsys.readouterr().err


def test_length_comes_from_the_shared_module() -> None:
    """Число берётся из общего места, а не объявлено заново.

    Сравнивать значения бесполезно: малые целые в Python кэшируются, и `12 is
    12` истинно у независимых объявлений — на этом уже попадался тест демо-сида
    (PR #200). Поэтому проверяется исходник.
    """
    from core.tools.db_guard import MIN_PASSWORD_LENGTH as shared

    assert shared == ADMIN.MIN_PASSWORD_LENGTH
    source = _SCRIPT.read_text(encoding="utf8")
    assert re.search(r"^MIN_PASSWORD_LENGTH\s*(:[^=]+)?=", source, re.M) is None
