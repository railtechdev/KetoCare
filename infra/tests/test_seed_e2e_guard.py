"""Защита сида прогонов от чужой базы.

Сид заводит врача с известным паролем И известным секретом второго фактора: на
чужой базе это означает, что второго фактора там больше нет. До этого теста
защиту не проверял никто — `infra/` не покрыт вовсе, — и ошибка в ней
обнаружилась бы ровно один раз, на боевой базе.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "seed_e2e.py"


def _guard():
    spec = importlib.util.spec_from_file_location("seed_e2e_guard", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


GUARD = _guard()

LOCAL = "postgresql+asyncpg://ketocare:ketocare@localhost:5432/ketocare"


@pytest.mark.parametrize(
    "url",
    [
        LOCAL,
        "postgresql+asyncpg://ketocare:ketocare@127.0.0.1:5434/ketocare",
        # IPv6 пишется в скобках — иначе строка невалидна и разбор падает
        # (такая запись проверяется ниже, среди отвергаемых).
        "postgresql+asyncpg://ketocare:ketocare@[::1]:5432/ketocare",
    ],
)
def test_local_addresses_pass(url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    GUARD._refuse_production(url)


@pytest.mark.parametrize(
    ("url", "why"),
    [
        (
            "postgresql+asyncpg://ketocare:pass@postgres:5432/ketocare",
            "имя сервиса боевого compose — именно так объявлена боевая база",
        ),
        (
            "postgresql+asyncpg://ketocare:pass@db.internal:5432/ketocare_stage",
            "чужой хост",
        ),
        (
            "postgresql+asyncpg://ketocare:pass@localhost:5432/ketocare_prod",
            "локальный хост, но имя базы боевое — так выглядит туннель",
        ),
        (
            "postgresql+asyncpg://ketocare:pass@app.railtech.uz:5432/ketocare",
            "боевой домен",
        ),
        ("не строка подключения вовсе", "разобрать нельзя"),
        (
            "postgresql+asyncpg://ketocare:pass@::1:5432/ketocare",
            "IPv6 без скобок — строка невалидна, и молча пропускать её нельзя",
        ),
    ],
)
def test_foreign_addresses_are_refused(url: str, why: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    with pytest.raises(SystemExit) as refusal:
        GUARD._refuse_production(url)
    assert "второго фактора" in str(refusal.value), why


@pytest.mark.parametrize(
    "query",
    ["sslmode=require", "application_name=ketocare", "options=-c%20timezone%3DUTC"],
)
def test_legitimate_query_parameters_pass(query: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # Отвергается подмена адреса, а не параметры вообще: ужесточение «любой
    # параметр — отказ» сломало бы локальные строки подключения молча.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    GUARD._refuse_production(f"{LOCAL}?{query}")


def test_unix_socket_is_local(monkeypatch: pytest.MonkeyPatch) -> None:
    # Путь в `host=` — сокет, а он локален по определению; подменить им адрес
    # нельзя, и отказ с причиной «адрес подменяется» был бы неправдой.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    GUARD._refuse_production(
        "postgresql+asyncpg://ketocare:pass@/ketocare?host=/var/run/postgresql"
    )


def test_host_list_with_network_fallback_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # `host=/var/run,evil.com` — список отказоустойчивости asyncpg: не найдя
    # сокета, драйвер идёт на второй адрес. Признавать такую строку локальной
    # значит открыть чужую базу под видом сокета.
    # БЕЗ `port=`: со списком портов строку отвергала бы соседняя проверка, и
    # тест был бы зелёным не по своей причине — проверено мутацией.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    with pytest.raises(SystemExit):
        GUARD._refuse_production(
            "postgresql+asyncpg://ketocare:pass@localhost:5432/ketocare?host=/var/run,evil.com"
        )


def test_socket_list_is_local(monkeypatch: pytest.MonkeyPatch) -> None:
    # Список из одних сокетов — по-прежнему локальное подключение.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    GUARD._refuse_production("postgresql+asyncpg://ketocare:pass@/ketocare?host=/var/run,/tmp")


def test_port_list_with_socket_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Список портов имеет смысл только со списком адресов — значит адрес
    # неоднозначен, даже если все его элементы выглядят сокетами.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    with pytest.raises(SystemExit):
        GUARD._refuse_production(
            "postgresql+asyncpg://ketocare:pass@/ketocare?host=/var/run,/tmp&port=5432,5433"
        )


def test_host_key_in_other_case_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Диалект различает регистр: `HOST=` он не разбирает как адрес, соединение
    # уйдёт на хост из адреса. Вердикт «локально» по такому ключу — неправда.
    # Хост в адресе ЛОКАЛЬНЫЙ, и текст отказа проверяется: иначе тест зелен и
    # без проверяемой ветки — отказ придёт от финальной проверки хоста, с
    # другим сообщением. Ровно та ошибка, которую я уже допускал сегодня.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    with pytest.raises(SystemExit) as refusal:
        GUARD._refuse_production(
            "postgresql+asyncpg://ketocare:pass@localhost:5432/ketocare?HOST=/var/run"
        )
    assert "HOST" in str(refusal.value)


def test_socket_beats_non_local_host_in_the_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Сегодня диалект отдаёт соединению путь из параметра, а не хост из адреса
    # (проверено на `create_connect_args`). Если это когда-нибудь поменяется,
    # сокет станет отмычкой для любого хоста — тест зафиксирует нынешнюю
    # семантику, чтобы смена была видимой.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    GUARD._refuse_production(
        "postgresql+asyncpg://ketocare:pass@db.internal:5432/ketocare?host=/var/run/postgresql"
    )


def test_trailing_dot_does_not_bypass_the_ban(monkeypatch: pytest.MonkeyPatch) -> None:
    # «postgres.» — тот же хост для DNS; без нормализации запрет обходится точкой.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "postgres.")
    with pytest.raises(SystemExit):
        GUARD._refuse_production("postgresql+asyncpg://ketocare:pass@postgres.:5432/ketocare")


def test_spaces_around_allow_value_are_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    # Пробел вокруг значения — опечатка, а не отказ от разрешения.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "  db.internal  ")
    GUARD._refuse_production("postgresql+asyncpg://ketocare:pass@db.internal:5432/ketocare")


def test_explicit_allow_names_the_host(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "postgresql+asyncpg://ketocare:pass@db.internal:5432/ketocare"

    # Разрешение — на КОНКРЕТНЫЙ хост: «1» или чужое имя не открывает ничего.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "1")
    with pytest.raises(SystemExit):
        GUARD._refuse_production(url)

    monkeypatch.setenv(GUARD._ALLOW_HOST, "other.host")
    with pytest.raises(SystemExit):
        GUARD._refuse_production(url)

    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    GUARD._refuse_production(url)


@pytest.mark.parametrize("service", ["postgres", "db"])
def test_allow_does_not_accept_compose_service_names(
    service: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Боевая строка подключения подсказок не содержит вовсе, а отказ называет
    # хост «postgres» — человек на сервере подставил бы его в переменную, и
    # блокер вернулся бы через ту самую подсказку.
    monkeypatch.setenv(GUARD._ALLOW_HOST, service)
    with pytest.raises(SystemExit) as refusal:
        GUARD._refuse_production(f"postgresql+asyncpg://ketocare:pass@{service}:5432/ketocare")
    assert "compose" in str(refusal.value)


def test_host_parameter_cannot_redirect_the_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Драйвер уважает `?host=`: разобранный хост локальный, а соединение уходит
    # на чужой. Проверять надо то, чем соединяются.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    with pytest.raises(SystemExit) as refusal:
        GUARD._refuse_production(
            "postgresql+asyncpg://ketocare:pass@localhost:5432/ketocare?host=other"
        )
    assert "host" in str(refusal.value)


def test_password_is_not_searched_for_hints(monkeypatch: pytest.MonkeyPatch) -> None:
    # Пароль со слогом «prod» — совпадение, а не признак боевой базы.
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    GUARD._refuse_production("postgresql+asyncpg://ketocare:myprodigy@localhost:5432/ketocare")


def test_allow_does_not_open_production_by_name(monkeypatch: pytest.MonkeyPatch) -> None:
    # Признак в строке подключения сильнее разрешения: подтверждать туннель к
    # бою переменной окружения нельзя.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "localhost")
    with pytest.raises(SystemExit):
        GUARD._refuse_production("postgresql+asyncpg://ketocare:pass@localhost:5432/ketocare_prod")


def test_guard_runs_before_the_engine_is_created(monkeypatch: pytest.MonkeyPatch) -> None:
    """Защита обязана быть ВЫЗВАНА, а не просто написана.

    Остальные тесты зовут проверку напрямую и снятия вызова из `main()` не
    поймают. Дыра нашлась ревью PR #194 мутацией: удаление одной строки из
    `main()` не роняло ни одного из тридцати пяти тестов — при том что цена
    ошибки здесь выше, чем у демо-сида (известен не только пароль, но и секрет
    второго фактора), и запускается сид в CI.
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

    monkeypatch.setattr(GUARD, "get_settings", _settings)
    monkeypatch.setattr(GUARD, "_refuse_production", _guard)
    monkeypatch.setattr(GUARD, "create_async_engine", _engine)

    with pytest.raises(_Stop):
        asyncio.run(GUARD.main())

    assert calls == ["guard", "engine"]


def test_credentials_are_required_when_the_host_is_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Разрешение открывает нелокальную базу — умолчания из репозитория там
    # недопустимы. Отказ обязан назвать обе переменные.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._TOTP_VAR in str(refusal.value)
    assert GUARD._PASSWORD_VAR in str(refusal.value)


def test_password_alone_is_not_enough(monkeypatch: pytest.MonkeyPatch) -> None:
    # Секрет второго фактора опаснее пароля: с известным секретом второго
    # фактора у врача нет вовсе. Пароль без секрета проходить не должен.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "свой пароль")
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._TOTP_VAR in str(refusal.value)


def test_secret_alone_is_not_enough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._TOTP_VAR, "SVOYSEKRET234567ABCDEFGHIJKLMNOP")
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._PASSWORD_VAR in str(refusal.value)


def test_both_given_satisfy_the_requirement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "свой пароль")
    monkeypatch.setenv(GUARD._TOTP_VAR, "SVOYSEKRET234567ABCDEFGHIJKLMNOP")
    GUARD._require_credentials_on_allowed_host()


def test_nightly_run_does_not_require_anything(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ночной прогон переменных не задаёт — и не должен ломаться.

    `.github/workflows/e2e.yml` не объявляет ни пароля, ни секрета, а
    `global-setup.ts` передаёт сиду то же, что взял прогон: обе стороны сходятся
    на умолчаниях осознанно. Глухое требование убило бы сторожа целиком.
    """
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    monkeypatch.delenv(GUARD._PASSWORD_VAR, raising=False)
    monkeypatch.delenv(GUARD._TOTP_VAR, raising=False)
    GUARD._require_credentials_on_allowed_host()


def test_blank_values_do_not_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "   ")
    monkeypatch.setenv(GUARD._TOTP_VAR, "  ")
    with pytest.raises(SystemExit):
        GUARD._require_credentials_on_allowed_host()


def test_checked_values_are_the_ones_used(monkeypatch: pytest.MonkeyPatch) -> None:
    # Значения читаются при обращении, а не снимаются при импорте: иначе
    # проверка удостоверяет одно, а в базу уходит другое.
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "  заданный  ")
    monkeypatch.setenv(GUARD._TOTP_VAR, "  SEKRET234567ABCDEFGHIJKLMNOPQRS  ")
    assert GUARD._password() == "заданный"
    assert GUARD._totp_secret() == "SEKRET234567ABCDEFGHIJKLMNOPQRS"
    monkeypatch.delenv(GUARD._PASSWORD_VAR, raising=False)
    monkeypatch.delenv(GUARD._TOTP_VAR, raising=False)
    assert GUARD._password() == GUARD._PASSWORD_DEFAULT
    assert GUARD._totp_secret() == GUARD._TOTP_DEFAULT


def test_main_refuses_without_credentials_on_allowed_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Сквозной отказ настоящими функциями, без подмен проверок."""

    class _Stop(Exception):
        pass

    def _engine(database_url: str) -> None:
        raise _Stop

    monkeypatch.setattr(GUARD, "get_settings", lambda: SimpleNamespace(database_url=LOCAL))
    monkeypatch.setattr(GUARD, "create_async_engine", _engine)
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.delenv(GUARD._PASSWORD_VAR, raising=False)
    monkeypatch.delenv(GUARD._TOTP_VAR, raising=False)

    with pytest.raises(SystemExit) as refusal:
        asyncio.run(GUARD.main())
    assert GUARD._TOTP_VAR in str(refusal.value)


def test_checked_password_is_the_one_hashed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Проверенное значение обязано быть тем самым, которое хешируется.

    Тест значения этого не ловит: он проверяет функцию, а не её связь с местом
    применения — мутация «хешировать зашитое умолчание» выживала.
    """
    written: dict[str, str] = {}

    class _Users:
        @staticmethod
        async def get_by_email(session: object, email: str) -> None:
            return None

        @staticmethod
        async def create(session: object, **fields: str) -> object:
            written.update(fields)
            return object()

    monkeypatch.setattr(GUARD, "users_repo", _Users)
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "пароль со стенда")

    asyncio.run(
        GUARD._user(
            None,
            GUARD.UserRole.DOCTOR,
            "Врач Прогонов",
            GUARD.DOCTOR_EMAIL,
            lambda value: f"hash:{value}",
        )
    )

    assert written["password_hash"] == "hash:пароль со стенда"


def test_checked_secret_is_the_one_written_to_the_doctor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """То же про секрет второго фактора — он опаснее пароля.

    Присваивание живёт внутри `main()`, поэтому проверяется выполнением: учётки
    подменены заглушками, а работа обрывается сразу после присваивания.
    """

    class _Stop(Exception):
        pass

    class _Account:
        def __init__(self, email: str) -> None:
            self.email = email
            self.id = f"id-{email}"
            # Оба поля НЕ пусты изначально: с `None` утверждение «фактор снят»
            # было бы верно и без кода сида — проверка впустую.
            self.totp_secret: str | None = "прежний секрет"
            self.totp_pending_secret: str | None = "прежнее"

    # Учётки РАЗНЫЕ: одним объектом на обоих врачей тест позеленел бы по ложной
    # причине — строкой ниже сид обнуляет фактор ВТОРОМУ врачу, и проверяемое
    # значение затёрлось бы.
    accounts: dict[str, _Account] = {}

    class _Session:
        async def __aenter__(self) -> _Session:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def execute(self, *args: object) -> None:
            return None

    class _Engine:
        async def dispose(self) -> None:
            return None

    async def _user(session, role, full_name, email, hash_password):  # type: ignore[no-untyped-def]
        return accounts.setdefault(email, _Account(email))

    def _category(session: object) -> None:
        raise _Stop

    monkeypatch.setattr(GUARD, "get_settings", lambda: SimpleNamespace(database_url=LOCAL))
    monkeypatch.setattr(GUARD, "create_async_engine", lambda url: _Engine())
    monkeypatch.setattr(GUARD, "async_sessionmaker", lambda engine, **kw: lambda: _Session())
    monkeypatch.setattr(GUARD, "_user", _user)
    monkeypatch.setattr(GUARD, "_category", _category)
    monkeypatch.setenv(GUARD._TOTP_VAR, "SEKRETSOSTENDA234567ABCDEFGHIJK")

    with pytest.raises(_Stop):
        asyncio.run(GUARD.main())

    doctor = accounts[GUARD.DOCTOR_EMAIL]
    assert doctor.totp_secret == "SEKRETSOSTENDA234567ABCDEFGHIJK"
    assert doctor.totp_pending_secret is None
    # А врачу первичной настройки фактор обязан быть снят — иначе тест
    # утверждал бы про того, у кого секрет и так задаётся.
    assert accounts[GUARD.DOCTOR_SETUP_EMAIL].totp_secret is None


def test_default_value_does_not_count_as_given(monkeypatch: pytest.MonkeyPatch) -> None:
    """Умолчание из репозитория — это НЕ заданное значение.

    `apps/e2e/global-setup.ts` передаёт сиду ровно то, что взял у себя, а при
    пустом окружении там берётся то же умолчание. Проверка «переменная
    объявлена» такой запуск пропустила бы, и отказ обещал бы больше, чем делает.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, GUARD._PASSWORD_DEFAULT)
    monkeypatch.setenv(GUARD._TOTP_VAR, GUARD._TOTP_DEFAULT)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._TOTP_VAR in str(refusal.value)
    assert GUARD._PASSWORD_VAR in str(refusal.value)


def test_existing_account_gets_the_checked_password(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ветка ПОВТОРНОГО запуска — не менее важная, чем создание.

    Сид повторяемый: со второго прогона работает именно она. Мутация «хешировать
    умолчание» здесь выживала — тест создания её не видит.
    """
    existing = SimpleNamespace(password_hash="прежний хеш", is_active=False)

    class _Users:
        @staticmethod
        async def get_by_email(session: object, email: str) -> object:
            return existing

    monkeypatch.setattr(GUARD, "users_repo", _Users)
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "пароль со стенда")

    asyncio.run(
        GUARD._user(
            None,
            GUARD.UserRole.DOCTOR,
            "Врач Прогонов",
            GUARD.DOCTOR_EMAIL,
            lambda value: f"hash:{value}",
        )
    )

    assert existing.password_hash == "hash:пароль со стенда"
    assert existing.is_active is True
