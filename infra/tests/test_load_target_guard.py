"""Защита нагрузочного профиля от чужой цели.

Профиль ПИШЕТ записи в дневник: на стенде это записи живой семьи, и убрать их
можно только `core.tools.erase_patient`. Прежде здесь стояла печать
«ВНИМАНИЕ: цель похожа на настоящий стенд», после которой прогон продолжался, —
правило существовало в тексте и ни в одном исполняемом виде.
"""

from __future__ import annotations

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


def test_local_target_passes() -> None:
    PROFILE.refuse_foreign_target(LOCAL)


def test_stand_like_target_is_refused() -> None:
    with pytest.raises(RuntimeError) as refusal:
        PROFILE.refuse_foreign_target(STAND)
    # Отказ обязан называть цену: записи в дневнике живой семьи.
    assert "дневник" in str(refusal.value)
    assert PROFILE.ALLOW_TARGET in str(refusal.value)


def test_https_target_is_refused_even_without_the_domain() -> None:
    # Своего домена у стенда может и не быть; `https://` — сам по себе признак
    # чужой цели: локально профиль ходит по http.
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target("https://demo.example.com")


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
    `locust` и `requests`, которых нет в общем окружении, и тест на выполнении
    проверял бы наличие зависимости. Слабее, чем прогон, и об этом сказано
    прямо — но снятие вызова ловит.
    """
    source = _PROFILE.read_text(encoding="utf8")
    assert "refuse_foreign_target(host)" in source
    assert "from target_guard import refuse_foreign_target" in source
