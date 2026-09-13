"""Защита сида прогонов от чужой базы.

Сид заводит врача с известным паролем И известным секретом второго фактора: на
чужой базе это означает, что второго фактора там больше нет. До этого теста
защиту не проверял никто — `infra/` не покрыт вовсе, — и ошибка в ней
обнаружилась бы ровно один раз, на боевой базе.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

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
    monkeypatch.delenv(GUARD._ALLOW_HOST, raising=False)
    with pytest.raises(SystemExit):
        GUARD._refuse_production(
            "postgresql+asyncpg://ketocare:pass@db.internal:5432/ketocare?HOST=/var/run"
        )


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
