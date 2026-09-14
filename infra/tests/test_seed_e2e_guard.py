"""Защита сида прогонов от чужой базы.

Сид заводит врача с известным паролем И известным секретом второго фактора: на
чужой базе это означает, что второго фактора там больше нет. До этого теста
защиту не проверял никто: тестов у `infra/` не было вовсе, а линт туда
добавлен только в PR #198 — ошибка в ней обнаружилась бы ровно один раз, на
боевой базе.
"""

from __future__ import annotations

import asyncio
import importlib.util
import re
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "seed_e2e.py"


def _guard() -> ModuleType:
    spec = importlib.util.spec_from_file_location("seed_e2e_under_test", _SCRIPT)
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


#: Значения, которые обязаны проходить: не умолчание, не короче общего
#: минимума, секрет — base32 нужной длины.
STRONG_PASSWORD = "пароль со стенда прогонов"
STRONG_SECRET = "SVOYSEKRET234567ABCDEFGHIJKLMNOP"


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
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
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
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
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


def test_short_password_is_refused_on_allowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """Не умолчание — ещё не стойкое.

    `E2E_PASSWORD=x` проходило сторожа насквозь: значение не равно умолчанию,
    значит «задано». При этом сид заводит врача, которому тем же запуском
    выдаётся известный секрет второго фактора.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "x")
    monkeypatch.setenv(GUARD._TOTP_VAR, STRONG_SECRET)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._PASSWORD_VAR in str(refusal.value)
    assert str(GUARD.MIN_PASSWORD_LENGTH) in str(refusal.value)


def test_password_of_exactly_the_minimum_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    # Граница: с нестрогим сравнением этот пароль отвергался бы.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "x" * GUARD.MIN_PASSWORD_LENGTH)
    monkeypatch.setenv(GUARD._TOTP_VAR, STRONG_SECRET)
    GUARD._require_credentials_on_allowed_host()


def test_password_one_short_of_the_minimum_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Точка вплотную к границе: без неё сравнение можно ослабить до `< 11`,
    # оставив константу и текст отказа нетронутыми (ревью #202).
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, "x" * (GUARD.MIN_PASSWORD_LENGTH - 1))
    monkeypatch.setenv(GUARD._TOTP_VAR, STRONG_SECRET)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._PASSWORD_VAR in str(refusal.value)


def test_secret_one_short_of_the_minimum_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # То же у секрета: окно 17-25 символов не проверял никто.
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "A" * (GUARD.MIN_TOTP_CHARS - 1))
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._TOTP_VAR in str(refusal.value)


def test_password_minimum_comes_from_the_shared_module() -> None:
    """Минимум один на все сиды, а не объявлен здесь заново.

    Сравнивать значения бесполезно — малые целые кэшируются. Проверяется
    исходник: своего присваивания быть не должно, только импорт.
    """
    from core.tools.db_guard import MIN_PASSWORD_LENGTH as shared

    assert shared == GUARD.MIN_PASSWORD_LENGTH
    source = _SCRIPT.read_text(encoding="utf8")
    assert re.search(r"^MIN_PASSWORD_LENGTH\s*(:[^=]+)?=", source, re.M) is None


def test_short_secret_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """Короткий секрет второго фактора не лучше известного.

    RFC 4226 §4: общий секрет не короче 128 бит. В base32 это 26 символов;
    парольная мерка тут не годится — двенадцать символов base32 дают 60 бит.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "SHORT234")
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._TOTP_VAR in str(refusal.value)
    assert str(GUARD.MIN_TOTP_CHARS) in str(refusal.value)


def test_secret_minimum_is_not_the_password_measure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Мера секрета задана СТАНДАРТОМ, а не значением константы.

    Тесты, выраженные через `MIN_TOTP_CHARS`, уезжают вместе с ней: подмена
    `MIN_TOTP_CHARS = 12` (парольная мерка) не роняла ничего, хотя двенадцать
    символов base32 — это 60 бит, вдвое меньше нижней границы RFC 4226 §4.
    Поэтому здесь стоит само число из стандарта и длина, которая обязана быть
    отвергнута при любой константе.
    """
    # 128 бит / 5 бит на символ base32 = 26 символов, вверх до целого.
    assert GUARD.MIN_TOTP_CHARS >= 26, (
        "минимум ниже 128 бит RFC 4226 §4 — парольная мерка секрету не годится"
    )

    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    # 16 символов base32 — 80 бит: слабый секрет, который парольная мерка
    # пропускает, а стандарт нет.
    monkeypatch.setenv(GUARD._TOTP_VAR, "ABCDEFGH23456789")
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert GUARD._TOTP_VAR in str(refusal.value)


def test_secret_of_exactly_the_minimum_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "A" * GUARD.MIN_TOTP_CHARS)
    GUARD._require_credentials_on_allowed_host()


@pytest.mark.parametrize(
    "secret",
    [
        "0" + "A" * 31,
        "1" + "A" * 31,
        "A" * 31 + "8",
        "A" * 31 + "9",
        "A" * 15 + "-" + "A" * 16,
        "A" * 25 + "=",
    ],
)
def test_single_character_outside_base32_is_refused(
    secret: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Каждый класс нарушения — отдельным знаком, а не одним грубым примером.

    Прежний случай нарушал алфавит сразу тремя способами, поэтому подмена
    алфавита на `A-Z0-9` его переживала — а `0`, `1`, `8` и `9` это ровно те
    знаки, на которых разбор секрета отказывает. Перечислены все шесть, что
    называет докстринг сида: с тремя из них подмены `+= "1"`, `+= "8"` и
    `+= "-"` проходили насквозь (ревью #202).

    Знак равенства стоит здесь по другой причине, и она названа в сиде. Пример
    выбран тот, на котором расхождение ИЗМЕРЕНО: `"A" * 25 + "="` прогон
    срезает и код считает, а сервер падает `Incorrect padding`. Канонически
    дополненную строку приняли бы обе стороны — на ней этот довод не стоит
    проверять, и прежняя редакция теста ошибалась именно так.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, secret)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert "base32" in str(refusal.value)


def test_lowercase_secret_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    """Строчный секрет рабочий, и отвергать его нельзя.

    `pyotp` декодирует с `casefold=True`, а `apps/e2e/src/totp.ts` сам
    приводит к верхнему регистру: код сходится. Отказ здесь был бы отказом
    годному значению с неверной причиной в сообщении.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, STRONG_SECRET.lower())
    GUARD._require_credentials_on_allowed_host()


def test_secret_outside_base32_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """Секрет с чужими знаками не усилит второй фактор, а сломает вход.

    `pyotp.random_base32()` и разбор в `apps/e2e/src/totp.ts` знают только
    A-Z и 2-7: код просто не сойдётся, и падение будет выглядеть как «неверный
    код подтверждения» без объяснимой причины.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "svoy-sekret-234567-abcdefghijk!!")
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert "base32" in str(refusal.value)


def test_strength_is_checked_for_the_values_actually_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Проверяется то самое значение, которое уходит врачу и в хеш.

    Иначе повторилась бы ошибка «правило написано, но не вызвано»: сторож мог
    бы мерить умолчание, пока в базу уходит значение из окружения.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "SHORT234")
    with pytest.raises(SystemExit):
        GUARD._require_credentials_on_allowed_host()
    # И наоборот: слабое значение в окружении, сильное умолчание — тоже отказ.
    assert GUARD._totp_secret() == "SHORT234"
    assert len(GUARD._TOTP_DEFAULT) >= GUARD.MIN_TOTP_CHARS


@pytest.mark.parametrize("length", [27, 30, 33])
def test_secret_of_unparseable_length_is_refused(
    length: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Длина, которую сервер не разбирает, — тоже неисправный секрет.

    Такой секрет состоит только из разрешённых букв и длиннее минимума, но
    `pyotp` падает на нём `Incorrect padding`, а прогон код считает. Сторож
    пропускал их насквозь (ревью #202, третий заход): граница снизу не была
    связана с разбираемой длиной.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "A" * length)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert "base32" in str(refusal.value)


def test_default_secret_satisfies_its_own_rules() -> None:
    """Умолчание обязано проходить те же проверки, что и заданное значение.

    Именно им живёт ночной прогон: переменных он не задаёт. Испорченное
    умолчание (знак вне алфавита, неразбираемая длина) дало бы тот же
    безымянный отказ входа, а правила к нему не применялись вовсе.
    """
    default = GUARD._TOTP_DEFAULT
    assert len(default) >= GUARD.MIN_TOTP_CHARS
    assert len(default) % 8 in GUARD._BASE32_BLOCK_TAILS
    assert not set(default.upper()) - GUARD._TOTP_ALPHABET
    assert len(GUARD._PASSWORD_DEFAULT) >= GUARD.MIN_PASSWORD_LENGTH


def test_secret_below_the_minimum_names_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """Граница минимума проверяется длиной, которая до неё ДОХОДИТ.

    Прежняя точка (`MIN_TOTP_CHARS - 1` = 25 знаков) имеет остаток 1 и потому
    перехватывается проверкой разбираемости — ослабление минимума до 17 снова
    перестало ронять тесты (ревью #202, четвёртый заход). Двадцать четыре
    знака разбираемы (остаток 0) и до минимума доходят, а сообщение обязано
    называть само число: иначе отказ неотличим от соседнего.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "A" * 24)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    assert str(GUARD.MIN_TOTP_CHARS) in str(refusal.value)


@pytest.mark.parametrize("extra", [0, 2, 3, 5, 6, 14])
def test_parseable_lengths_pass(extra: int, monkeypatch: pytest.MonkeyPatch) -> None:
    """Рабочие длины обязаны проходить, иначе сторож начнёт врать в свою пользу.

    Набор остатков можно сузить до `{0, 2, 7}`, не уронив ни одного теста:
    отвергаемые 27, 30 и 33 закрыты, а принимаемые — только 0 и 2. Тогда сторож
    молча отверг бы секрет, который сервер разбирает (28 и 29 знаков проверены
    исполнением на настоящем `pyotp`).

    Длины отсчитываются ОТ минимума, чтобы читалось «минимум и сколько-то
    сверх», а не набор магических чисел. Защиты от ужесточения это НЕ даёт, и
    обещать её нельзя (ревью #202, пятый заход): набор остатков сохраняется,
    только пока новый минимум сравним с нынешним по модулю восемь. Подъём до
    рекомендованных RFC 4226 тридцати двух знаков уронит этот тест, и менять
    минимум придётся вместе со смещениями.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "A" * (GUARD.MIN_TOTP_CHARS + extra))
    GUARD._require_credentials_on_allowed_host()


def test_whole_alphabet_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    """Секрет из ВСЕХ знаков алфавита обязан проходить.

    Ни одна фикстура не содержала `Q`, `U`, `W`, `X` и `Z`, поэтому из
    `_TOTP_ALPHABET` можно было выбросить букву, не уронив ни одного теста —
    и сторож начал бы отвергать нормальный секрет `pyotp.random_base32()`
    (ревью #202, пятый заход). Здесь ровно тридцать два знака base32, то есть
    и длина рекомендованных RFC 4226 ста шестидесяти бит.
    """
    whole = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    assert set(whole) == set(GUARD._TOTP_ALPHABET)

    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, whole)
    GUARD._require_credentials_on_allowed_host()


def test_refusal_lists_the_same_tails_as_the_code(monkeypatch: pytest.MonkeyPatch) -> None:
    """Сообщение перечисляет те же остатки, что и проверка.

    Перечень стоял в тексте прописью, и сужение множества оставляло сообщение
    врущим. Теперь текст строится из множества; тест держит эту связь.
    """
    monkeypatch.setenv(GUARD._ALLOW_HOST, "db.internal")
    monkeypatch.setenv(GUARD._PASSWORD_VAR, STRONG_PASSWORD)
    monkeypatch.setenv(GUARD._TOTP_VAR, "A" * 27)
    with pytest.raises(SystemExit) as refusal:
        GUARD._require_credentials_on_allowed_host()
    listed = ", ".join(str(tail) for tail in sorted(GUARD._BASE32_BLOCK_TAILS))
    assert listed in str(refusal.value)
