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
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "create_admin.py"
_ROOT = Path(__file__).resolve().parents[2]


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
DB_URL = "postgresql+asyncpg://ketocare:ketocare@postgres:5432/из-настроек"


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
    # Не `"--email" in ...`: argparse печатает usage, а там этот ключ есть
    # всегда — утверждение выполнялось бы при любом тексте ошибки.
    assert "адресом почты" in capsys.readouterr().err


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
    проходит (ревью #201). Проверяется дерево разбора, и трёх утверждений
    нужно ровно три, потому что обойти можно каждое поодиночке: сравнение одно,
    имя пришло из общего модуля, и в самом скрипте оно не присвоено — копия
    рядом с импортом сегодня совпадает значением, а разойдётся молча.

    Считаются только сравнения с именем из общего модуля: иначе невинное
    `len(args.name) < 1` роняло бы этот тест с сообщением про пароль.
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
    limits = [
        right
        for node in ast.walk(tree)
        if isinstance(node, ast.Compare)
        and isinstance(node.left, ast.Call)
        and isinstance(node.left.func, ast.Name)
        and node.left.func.id == "len"
        for right in node.comparators
        if isinstance(right, ast.Name) and right.id in from_shared
    ]
    assert len(limits) == 1, (
        "длина пароля должна сравниваться ровно один раз и с именем из "
        "core.tools.db_guard: число на месте или своё имя разойдутся молча"
    )

    targets = [
        target
        for node in ast.walk(tree)
        for target in (
            node.targets
            if isinstance(node, ast.Assign)
            else [node.target]
            if isinstance(node, ast.AnnAssign)
            else []
        )
        if isinstance(target, ast.Name)
    ]
    assert limits[0].id not in {target.id for target in targets}, (
        f"{limits[0].id} присвоено в самом скрипте — копия рядом с импортом сегодня "
        "совпадает со значением, а разойдётся молча"
    )


# --- работа с базой: сессия поддельная, движок и хеширование подменены -------


def _fake_db(monkeypatch: pytest.MonkeyPatch, existing: object | None = None) -> SimpleNamespace:
    """Подменить всё, что ходит наружу, и записывать, что скрипт сделал."""
    recorder = SimpleNamespace(
        created={}, added=[], commits=0, disposed=0, user=None, engine_url=None, session_kwargs={}
    )

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

    def _engine(url: str) -> _Engine:
        recorder.engine_url = url
        return _Engine()

    def _maker(engine: object, **kw: object) -> type[_Session]:
        recorder.session_kwargs.update(kw)
        return _Session

    monkeypatch.setattr(ADMIN, "get_settings", lambda: SimpleNamespace(database_url=DB_URL))
    monkeypatch.setattr(ADMIN, "create_async_engine", _engine)
    monkeypatch.setattr(ADMIN, "async_sessionmaker", _maker)
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


def test_generated_password_is_long_and_different_every_time(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Сгенерированный пароль не постоянен и не короче обещанного.

    Утверждать по двум выходам «непредсказуем» нельзя: счётчик и
    `random.Random(1234)` эту проверку проходят (ревью #201, третий заход).
    Стойкость источника закреплена отдельно — разбором дерева, потому что из
    наблюдения выходов её не вывести.

    Длина меряется дважды: общим минимумом (сгенерированный не может быть
    слабее того, что скрипт принимает от человека) и обещанием комментария у
    `TEMP_PASSWORD_BYTES` — иначе уменьшение числа байт проходит молча.
    """

    def _run() -> str:
        _fake_db(monkeypatch)
        assert ADMIN.main(ARGV) == 0
        shown = [
            line.split(":", 1)[1].strip()
            for line in capsys.readouterr().out.splitlines()
            if "Временный пароль:" in line
        ]
        assert len(shown) == 1
        return shown[0]

    first, second = _run(), _run()
    assert len(first) >= ADMIN.MIN_PASSWORD_LENGTH
    # 24 байта url-safe — это 32 символа, как и обещает комментарий скрипта.
    assert len(first) >= 32
    assert first != second


def test_account_is_created_for_the_given_email_and_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Учётка на чужом адресе — это администратор, которым нельзя войти.
    recorder = _fake_db(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main(ARGV) == 0
    assert recorder.created["email"] == "admin@clinic.example"
    assert recorder.created["full_name"] == "Админ Клиники"


def test_audit_row_names_the_account(monkeypatch: pytest.MonkeyPatch) -> None:
    """Правило 7 — это содержание записи, а не сам факт её наличия.

    Запись с чужим адресом или без идентификатора в журнале бесполезна, а
    выглядит как выполненное правило.
    """
    recorder = _fake_db(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main(ARGV) == 0

    row = _audit(recorder)[0]
    # Автора нет намеренно: команду запускает человек с доступом к серверу.
    assert row.user_id is None
    assert row.entity_id == recorder.user.id
    assert row.after["email"] == "admin@clinic.example"
    assert row.after["role"] == ADMIN.UserRole.ADMIN.value


def test_engine_takes_the_configured_url_and_session_keeps_objects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Единственное место, где подделка могла бы скрыть поведение.

    Ревью #201: зашитый адрес базы и `expire_on_commit=True` проходили мимо
    теста, потому что подделка принимала любые аргументы. Теперь она их
    запоминает: адрес обязан прийти из настроек, а объекты — пережить commit,
    иначе `user.id` после него читать нельзя.
    """
    recorder = _fake_db(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main(ARGV) == 0
    assert recorder.engine_url == DB_URL
    assert recorder.session_kwargs["expire_on_commit"] is False


def test_generated_password_comes_from_the_cryptographic_source() -> None:
    """Источник случайности закреплён кодом, а не наблюдением выходов.

    Отличить `secrets` от `random.Random(1234)` по двум паролям невозможно —
    оба «разные каждый раз». Ревью #201 показало это мутациями: счётчик,
    зерно, метка времени и pid проходили поведенческую проверку насквозь.
    Поэтому здесь проверяется, ЧЕМ порождён пароль.
    """
    tree = ast.parse(_SCRIPT.read_text(encoding="utf8"))
    imported = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "secrets" in imported

    bodies = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_generate_password"
    ]
    assert len(bodies) == 1
    calls = [node for node in ast.walk(bodies[0]) if isinstance(node, ast.Call)]
    assert len(calls) == 1, "пароль собирается из нескольких вызовов — источник неочевиден"
    source = calls[0].func
    assert isinstance(source, ast.Attribute) and source.attr.startswith("token_"), (
        "пароль порождён не `secrets.token_*` — слабый источник неотличим по выходам"
    )
    assert isinstance(source.value, ast.Name) and source.value.id == "secrets"


def test_password_variable_name_is_the_one_the_deploy_passes() -> None:
    """Имя переменной — контракт с выкатом, а не внутреннее дело скрипта.

    Разойдись оно с `deploy.yml` и `remote-deploy.sh` — скрипт молча уйдёт в
    ветку «пароль не задан», сгенерирует свой и НАПЕЧАТАЕТ его в журнал
    публичного прогона. Ровно то, ради чего переменная и заведена.
    """
    for relative in (".github/workflows/deploy.yml", "infra/scripts/remote-deploy.sh"):
        text = (_ROOT / relative).read_text(encoding="utf8")
        # По границе слова, а не подстрокой: `ADMIN_PASS` нашлось бы ВНУТРИ
        # `ADMIN_PASSWORD`, и переименование переменной прошло бы незамеченным.
        found = re.search(rf"\b{re.escape(ADMIN.PASSWORD_ENV)}\b", text)
        assert found is not None, f"{relative} не передаёт {ADMIN.PASSWORD_ENV}"


def test_exit_code_reaches_the_shell() -> None:
    """Код возврата обязан дойти до вызывающего.

    `remote-deploy.sh` судит по нему об успехе. Без `sys.exit(main())` отказы
    (чужая роль, занятый адрес) стали бы «успехом» — блок `__main__` не
    исполняется ни одним тестом внутри процесса, поэтому здесь подпроцесс.
    """
    # Отказ argparse для этого не годится: `parser.error` выходит сам, и код 2
    # приходит даже без `sys.exit(main())`. Нужен код, который main ВЕРНУЛ.
    code = f"""
import asyncio, runpy, sys

sys.argv = ["create_admin.py", "--email", "admin@clinic.example", "--name", "Админ"]


def _stop(coro):
    coro.close()
    return 7


asyncio.run = _stop
runpy.run_path({str(_SCRIPT)!r}, run_name="__main__")
"""
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert done.returncode == 7, "возвращённый код не дошёл до оболочки"

    # И заодно: скрипт запускается как программа, а отказ доходит текстом.
    refused = subprocess.run(
        [sys.executable, str(_SCRIPT), "--email", "без-собаки", "--name", "Админ Клиники"],
        capture_output=True,
        text=True,
    )
    assert refused.returncode == 2
    assert "адресом почты" in refused.stderr


def test_both_arguments_are_required(capsys: pytest.CaptureFixture[str]) -> None:
    for argv in (["--email", "admin@clinic.example"], ["--name", "Админ Клиники"]):
        with pytest.raises(SystemExit) as refusal:
            ADMIN.main(argv)
        assert refusal.value.code == 2
        capsys.readouterr()


def test_empty_variable_counts_as_no_password(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Пустое значение — это «не задан», а не «пароль нулевой длины»: иначе
    # выкат без секрета падал бы отказом по длине вместо генерации.
    _fake_db(monkeypatch)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, "")

    assert ADMIN.main(ARGV) == 0
    assert "Временный пароль:" in capsys.readouterr().out
