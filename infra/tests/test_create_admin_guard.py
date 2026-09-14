"""Тесты скрипта, заводящего первого администратора клиники.

У `create_admin.py` не было ни одного теста. Ревью PR #200 показало прямое
следствие: проверку длины пароля можно было удалить целиком, не уронив ничего.
Ревью PR #201 назвало ещё шесть таких же мест — и среди них дороже длины:
непечатание пароля из секретов, идемпотентность (на неё опирается автодеплой) и
запись в журнал аудита (правило 7). Здесь закрыты все.

Базы тесту не нужно: движок, фабрика сессий, репозиторий и хеширование
подменяются, а `session` — поддельная. Тот же приём у демо-сида
(`test_seed_demo_guard.py`).
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "create_admin.py"


def _load() -> ModuleType:
    # Ключ свой, не `create_admin_guard`: под ним тот же скрипт кладёт в
    # `sys.modules` загрузчик `test_seed_demo_guard.py`, и два разных объекта
    # модуля под одним именем — ловушка на будущее.
    spec = importlib.util.spec_from_file_location("create_admin_under_test", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ADMIN = _load()
ARGV = ["--email", "admin@clinic.example", "--name", "Админ Клиники"]
LONG_ENOUGH = "пароль-со-стенда-длинный"


@pytest.fixture(autouse=True)
def _no_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ADMIN.PASSWORD_ENV, raising=False)


# --- проверки аргументов: они идут до любой работы с базой ------------------


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


def test_email_without_at_sign_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    # Тот же класс, что нашло ревью #200: проверка есть, теста у неё нет.
    with pytest.raises(SystemExit) as refusal:
        ADMIN.main(["--email", "admin.clinic.example", "--name", "Админ Клиники"])
    assert refusal.value.code == 2
    assert "--email" in capsys.readouterr().err


def _without_real_work(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Остановить скрипт сразу после проверок аргументов, не доходя до базы.

    Ловить любое исключение нельзя: такая проверка проходит и когда падает сам
    тест. Поэтому подменяется `asyncio` — `main()` доходит до вызова и
    возвращает управление, а утверждение становится прямым: отказа не было.

    Подменяется атрибут МОДУЛЯ скрипта, а не `asyncio.run` в самом `asyncio`:
    у пакета `asyncio_mode = "auto"`, и заглушка в стандартном модуле досталась
    бы заодно любому асинхронному тесту рядом.
    """
    reached: list[str] = []

    def _stop(coro: Any) -> int:
        reached.append("работа")
        coro.close()
        return 0

    monkeypatch.setattr(ADMIN, "asyncio", SimpleNamespace(run=_stop))
    return reached


def test_password_of_minimum_length_passes_the_length_check(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Граница: с нестрогим `<=` вместо `<` этот случай отвергался бы.
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
    """Минимум берётся из общего модуля, а не объявлен в скрипте заново.

    Сравнивать значения бесполезно: малые целые в Python кэшируются, и `12 is
    12` истинно у независимых объявлений — на этом уже попадался тест демо-сида
    (PR #200). Поиск по тексту тоже слаб: копия под ДРУГИМ именем регулярку
    проходит, что показало ревью #201. Поэтому проверяется дерево разбора: с
    чем сравнивается длина и откуда это имя взялось.
    """
    from core.tools.db_guard import MIN_PASSWORD_LENGTH as shared

    assert shared == ADMIN.MIN_PASSWORD_LENGTH

    tree = ast.parse(_SCRIPT.read_text(encoding="utf8"))
    from_shared = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "core.tools.db_guard"
        for alias in node.names
    }
    compared = [
        right
        for node in ast.walk(tree)
        if isinstance(node, ast.Compare)
        and isinstance(node.left, ast.Call)
        and isinstance(node.left.func, ast.Name)
        and node.left.func.id == "len"
        for right in node.comparators
    ]

    assert len(compared) == 1, "проверка длины пароля в скрипте должна быть одна"
    limit = compared[0]
    assert isinstance(limit, ast.Name), "длина сравнивается с числом на месте, а не с общим именем"
    assert limit.id in from_shared, (
        f"{limit.id} не импортировано из core.tools.db_guard — своя копия разойдётся молча, "
        "как уже расходилась проверка адреса базы"
    )


# --- работа с базой: сессия поддельная, движок и хеширование подменены -------


def _fake_db(monkeypatch: pytest.MonkeyPatch, existing: object | None = None) -> SimpleNamespace:
    """Подменить всё, что ходит наружу, и записывать, что скрипт сделал."""
    recorder = SimpleNamespace(created={}, added=[], commits=0, disposed=0, user=None)

    class _Session:
        async def __aenter__(self) -> _Session:
            return self

        async def __aexit__(self, *exc: object) -> bool:
            return False

        def add(self, obj: object) -> None:
            recorder.added.append(obj)

        async def commit(self) -> None:
            recorder.commits += 1

    class _Engine:
        async def dispose(self) -> None:
            recorder.disposed += 1

    class _Users:
        @staticmethod
        async def get_by_email(session: object, email: str) -> object | None:
            return existing

        @staticmethod
        async def create(session: object, **fields: object) -> SimpleNamespace:
            recorder.created.update(fields)
            user = SimpleNamespace(id="id-нового", password_change_required=False)
            recorder.user = user
            return user

    monkeypatch.setattr(ADMIN, "get_settings", lambda: SimpleNamespace(database_url="—"))
    monkeypatch.setattr(ADMIN, "create_async_engine", lambda url: _Engine())
    monkeypatch.setattr(ADMIN, "async_sessionmaker", lambda engine, **kw: _Session)
    monkeypatch.setattr(ADMIN, "users_repo", _Users)
    monkeypatch.setattr("api.security.hash_password", lambda value: f"hash:{value}")
    return recorder


def _audit(recorder: SimpleNamespace) -> list[Any]:
    return [row for row in recorder.added if isinstance(row, ADMIN.AuditLog)]


def test_password_from_environment_is_not_printed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Заданный пароль не попадает в вывод.

    Команду запускает автодеплой, а журнал прогона публичного репозитория
    читает кто угодно — об этом прямо сказано в `infra/scripts/remote-deploy.sh`.
    Защита в скрипте была, теста у неё не было.
    """
    recorder = _fake_db(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main(ARGV) == 0

    out = capsys.readouterr().out
    assert LONG_ENOUGH not in out
    assert "в вывод не попадает" in out
    # И проверенное значение — то самое, которое хешируется.
    assert recorder.created["password_hash"] == f"hash:{LONG_ENOUGH}"


def test_generated_password_is_shown_once(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Сгенерированный пароль, наоборот, ОБЯЗАН быть напечатан.

    Иначе в свежую установку нельзя войти: в базе он только хешем. Без этого
    теста «не печатать никогда» выглядело бы как усиление защиты.
    """
    recorder = _fake_db(monkeypatch)

    assert ADMIN.main(ARGV) == 0

    printed = [
        line.split(":", 1)[1].strip()
        for line in capsys.readouterr().out.splitlines()
        if "Временный пароль:" in line
    ]
    assert len(printed) == 1
    # Напечатано ровно то, что ушло в хеш: печать другого значения означала бы
    # пароль, которым нельзя войти.
    assert recorder.created["password_hash"] == f"hash:{printed[0]}"


def test_new_admin_must_change_the_password_and_is_written_to_audit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = _fake_db(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main(ARGV) == 0

    assert recorder.created["role"] is ADMIN.UserRole.ADMIN
    # Пароль временный: при первом входе система обязана потребовать свой.
    assert recorder.user.password_change_required is True
    # Правило 7: операции с учётными записями пишутся в журнал.
    rows = _audit(recorder)
    assert len(rows) == 1
    assert (rows[0].action, rows[0].entity) == ("create", "users")
    assert rows[0].after["via"] == "create_admin"
    assert recorder.commits == 1
    assert recorder.disposed == 1


def test_repeated_run_changes_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Повторный запуск без `--reset-password` не трогает пароль.

    На это опирается автодеплой: он зовёт скрипт при каждом выкате. Без
    проверки каждый выкат сбрасывал бы доступ администратору клиники.
    """
    existing = SimpleNamespace(
        role=ADMIN.UserRole.ADMIN,
        full_name="Админ Клиники",
        email="admin@clinic.example",
        password_hash="старый-хеш",
        password_change_required=False,
    )
    recorder = _fake_db(monkeypatch, existing=existing)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main(ARGV) == 1
    assert existing.password_hash == "старый-хеш"
    assert existing.password_change_required is False
    assert _audit(recorder) == []
    assert recorder.commits == 0
    assert "уже есть" in capsys.readouterr().out


def test_reset_refuses_a_user_who_is_not_an_admin(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Сброс пароля не превращает врача в администратора и не трогает его вход."""
    existing = SimpleNamespace(
        role=ADMIN.UserRole.DOCTOR,
        full_name="Врач Клиники",
        email="admin@clinic.example",
        password_hash="хеш-врача",
        password_change_required=False,
    )
    recorder = _fake_db(monkeypatch, existing=existing)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main([*ARGV, "--reset-password"]) == 1
    assert existing.password_hash == "хеш-врача"
    assert existing.role is ADMIN.UserRole.DOCTOR
    assert _audit(recorder) == []
    assert recorder.commits == 0
    assert "не администратор" in capsys.readouterr().out


def test_reset_writes_a_new_password_and_keeps_the_second_factor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Сброс пароля не открывает вход тому, у кого нет аутентификатора."""
    existing = SimpleNamespace(
        role=ADMIN.UserRole.ADMIN,
        full_name="Админ Клиники",
        email="admin@clinic.example",
        password_hash="старый-хеш",
        password_change_required=False,
        totp_secret="секрет-администратора",
        id="id-существующего",
    )
    recorder = _fake_db(monkeypatch, existing=existing)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main([*ARGV, "--reset-password"]) == 0

    assert existing.password_hash == f"hash:{LONG_ENOUGH}"
    assert existing.password_change_required is True
    assert existing.totp_secret == "секрет-администратора"
    rows = _audit(recorder)
    assert len(rows) == 1
    assert rows[0].action == "reset_password"
    assert recorder.commits == 1
