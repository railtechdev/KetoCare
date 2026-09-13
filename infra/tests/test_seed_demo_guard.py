"""Защита демо-сида от чужой базы.

Сид заводит администратора и врача с паролем по умолчанию из репозитория и
СБРАСЫВАЕТ второй фактор учёткам с теми же адресами. До этой проверки его
удерживала фраза в комментарии «в бою этот скрипт не запускается» — при том что
docs/DEPLOY.md запуск на стенде прямо предписывает. Правило, живущее только в
тексте, не защищает ничего: ровно этот класс назван главным в SECURITY_REVIEW.

Проверка адреса общая с сидом прогонов (`core.tools.db_guard`) и там же покрыта
подробно. Здесь проверяется СВОЁ: что она подключена, что разрешение поимённое
и отдельное, и что имя службы compose открывается — в отличие от сида прогонов.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"{name}_guard", _SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


DEMO = _load("seed_demo")
E2E = _load("seed_e2e")

LOCAL = "postgresql+asyncpg://ketocare:ketocare@localhost:5432/ketocare"
COMPOSE = "postgresql+asyncpg://ketocare:pass@postgres:5432/ketocare"
FOREIGN = "postgresql+asyncpg://ketocare:pass@db.internal:5432/ketocare"


@pytest.fixture(autouse=True)
def _no_permissions(monkeypatch: pytest.MonkeyPatch) -> None:
    # Разрешения снимаются перед каждым тестом: иначе значение, выставленное
    # соседним, сделало бы отказ непроверяемым.
    monkeypatch.delenv(DEMO._ALLOW_HOST, raising=False)
    monkeypatch.delenv(E2E._ALLOW_HOST, raising=False)


def test_local_database_passes() -> None:
    DEMO._refuse_production(LOCAL)


def test_foreign_database_is_refused() -> None:
    with pytest.raises(SystemExit) as refusal:
        DEMO._refuse_production(FOREIGN)
    # Отказ обязан называть опасность ЭТОГО скрипта, а не общую: человек на
    # сервере читает сообщение, а не исходник.
    assert "второй фактор" in str(refusal.value)
    assert "админка" in str(refusal.value)


def test_refusal_names_its_own_variable() -> None:
    # Подсказка в отказе должна вести к переменной демо-сида: назови она чужую,
    # человек выставил бы разрешение, которое здесь ничего не открывает.
    with pytest.raises(SystemExit) as refusal:
        DEMO._refuse_production(FOREIGN)
    assert DEMO._ALLOW_HOST in str(refusal.value)
    assert E2E._ALLOW_HOST not in str(refusal.value)


def test_permission_names_the_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DEMO._ALLOW_HOST, "1")
    with pytest.raises(SystemExit):
        DEMO._refuse_production(FOREIGN)

    monkeypatch.setenv(DEMO._ALLOW_HOST, "other.host")
    with pytest.raises(SystemExit):
        DEMO._refuse_production(FOREIGN)

    monkeypatch.setenv(DEMO._ALLOW_HOST, "db.internal")
    DEMO._refuse_production(FOREIGN)


def test_permission_of_the_e2e_seed_does_not_open_the_demo_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Переменные разные намеренно: разрешение, выданное однажды для прогонов,
    # не должно молча открывать скрипт с другой опасностью.
    monkeypatch.setenv(E2E._ALLOW_HOST, "db.internal")
    with pytest.raises(SystemExit):
        DEMO._refuse_production(FOREIGN)


def test_compose_service_name_is_confirmable(monkeypatch: pytest.MonkeyPatch) -> None:
    # Законный путь из docs/DEPLOY.md: демо-данные ставят на стенд, где база
    # объявлена как `postgres`. Без разрешения — отказ.
    with pytest.raises(SystemExit):
        DEMO._refuse_production(COMPOSE)

    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    DEMO._refuse_production(COMPOSE)


def test_the_e2e_seed_still_refuses_compose_names(monkeypatch: pytest.MonkeyPatch) -> None:
    # Обратная сторона предыдущего: послабление сделано ТОЛЬКО демо-сиду. У
    # прогонов на стенде дела нет, и там имя службы не открывается разрешением.
    monkeypatch.setenv(E2E._ALLOW_HOST, "postgres")
    with pytest.raises(SystemExit) as refusal:
        E2E._refuse_production(COMPOSE)
    assert "compose" in str(refusal.value)


def test_production_hints_survive_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    # Признак боевой строки сильнее разрешения: туннель к бою подтверждать
    # переменной нельзя. Послабление про имена служб этого не отменяет.
    monkeypatch.setenv(DEMO._ALLOW_HOST, "localhost")
    with pytest.raises(SystemExit):
        DEMO._refuse_production("postgresql+asyncpg://ketocare:pass@localhost:5432/ketocare_prod")


def test_guard_runs_before_the_engine_is_created(monkeypatch: pytest.MonkeyPatch) -> None:
    """Защита обязана быть ВЫЗВАНА, а не просто написана.

    Остальные тесты зовут проверку напрямую и снятие вызова из `main()` не
    поймают — а это ровно тот дефект, ради которого задача и затевалась:
    правило существует и ни на что не влияет. Здесь выполняется сам `main()`,
    а создание движка подменено на отказ: порядок вызовов и есть утверждение.
    """
    calls: list[str] = []

    class _Stop(Exception):
        pass

    def _settings() -> SimpleNamespace:
        return SimpleNamespace(database_url=LOCAL)

    def _guard(database_url: str) -> None:
        calls.append("guard")

    def _engine(database_url: str) -> None:
        calls.append("engine")
        raise _Stop

    monkeypatch.setattr(DEMO, "get_settings", _settings)
    monkeypatch.setattr(DEMO, "_refuse_production", _guard)
    monkeypatch.setattr(DEMO, "create_async_engine", _engine)

    with pytest.raises(_Stop):
        asyncio.run(DEMO.main())

    assert calls == ["guard", "engine"]
