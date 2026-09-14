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


@pytest.mark.parametrize(
    "role",
    [role for role in ADMIN.UserRole if role is not ADMIN.UserRole.ADMIN],
    ids=lambda role: str(role.value),
)
def test_reset_refuses_a_user_who_is_not_an_admin(
    role: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Сброс пароля не превращает в администратора и не трогает чужой вход.

    Роли перебираются все: с одной ролью в тесте мутация `is not ADMIN` →
    `is DOCTOR` выживала, и родителю по тому же адресу пароль сбросило бы.
    """
    existing = SimpleNamespace(
        role=role,
        full_name="Врач Клиники",
        email="admin@clinic.example",
        password_hash="хеш-врача",
        password_change_required=False,
    )
    recorder = _fake_db(monkeypatch, existing=existing)
    monkeypatch.setenv(ADMIN.PASSWORD_ENV, LONG_ENOUGH)

    assert ADMIN.main([*ARGV, "--reset-password"]) == 1
    assert existing.password_hash == "хеш-врача"
    assert existing.role is role
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

    Правило намеренно не привязано ни к имени функции, ни к числу вызовов:
    переименование, `token_bytes(...).hex()` и постобработка вроде
    `.replace("-", "_")` — законные правки, и падать на них тест не должен
    (четвёртый заход ревью #201). Держится другое: пароль рождается ровно
    одним вызовом `secrets.token_*` с длиной из константы модуля, имя
    `secrets` в скрипте не переприсвоено, а `random` не используется вовсе.
    """
    tree = ast.parse(_SCRIPT.read_text(encoding="utf8"))
    modules = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    from_secrets = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "secrets"
        for alias in node.names
    }
    assert "secrets" in modules or from_secrets, "модуль secrets в скрипте не импортирован"

    sources = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if (
            isinstance(func, ast.Attribute)
            and func.attr.startswith("token_")
            and isinstance(func.value, ast.Name)
            and func.value.id == "secrets"
        ) or (isinstance(func, ast.Name) and func.id in from_secrets):
            sources.append(node)

    assert len(sources) == 1, (
        "пароль должен рождаться ровно одним вызовом secrets.token_* — "
        "иначе источник неочевиден, а слабый по выходам неотличим"
    )
    arguments = sources[0].args
    assert len(arguments) == 1 and isinstance(arguments[0], ast.Name), (
        "длина берётся не из константы модуля: вызов без аргумента оставляет "
        "TEMP_PASSWORD_BYTES сиротой, и обещание комментария ничем не держится"
    )

    assigned = {
        target.id
        for node in ast.walk(tree)
        for target in (
            node.targets
            if isinstance(node, ast.Assign)
            else [node.target]
            if isinstance(node, ast.AnnAssign)
            else []
        )
        if isinstance(target, ast.Name)
    }
    # Та же асимметрия, что закрыта для минимума длины: имя можно переприсвоить
    # после импорта, и вызов остался бы на вид тем же самым.
    assert "secrets" not in assigned
    assert arguments[0].id in assigned, "длина пароля задана не константой модуля"

    weak = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "random"
    ]
    assert not weak and "random" not in modules, "в скрипте используется random — это не CSPRNG"


def test_password_variable_name_is_the_one_the_deploy_passes() -> None:
    """Пароль обязан ДОЙТИ до скрипта, а не просто где-то упоминаться.

    Сценарий, ради которого это написано: переменная молча не доехала до
    контейнера, скрипт счёл, что пароль не задан, сгенерировал свой и
    напечатал его в журнал публичного прогона. Проверка «имя встречается в
    файле» его не ловила (ревью #201, четвёртый заход): упоминания остаются в
    ветке-предупреждении, даже когда передачи уже нет. Поэтому закреплены сами
    места передачи — и отдельно литерал, иначе `PASSWORD_ENV = "ADMIN_EMAIL"`
    проходило бы, читая пароль из адреса.
    """
    assert ADMIN.PASSWORD_ENV == "ADMIN_PASSWORD"
    name = re.escape(ADMIN.PASSWORD_ENV)

    runner = (_ROOT / "infra/scripts/remote-deploy.sh").read_text(encoding="utf8")
    assert re.search(rf"-e\s+{name}=", runner), (
        "remote-deploy.sh не передаёт переменную в контейнер — пароль не дойдёт"
    )

    workflow = (_ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf8")
    assert re.search(rf"^\s*{name}:\s*\$\{{\{{\s*secrets\.{name}\s*\}}\}}", workflow, re.M), (
        "deploy.yml не берёт пароль из секрета репозитория"
    )
    assert re.search(rf'"{name}"', workflow), (
        "deploy.yml не переносит переменную на сервер: её нет в списке имён"
    )


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
