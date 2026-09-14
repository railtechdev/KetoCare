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
from types import ModuleType, SimpleNamespace

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
        # Локальная цель БЕЗ схемы: ради неё и сделана подстановка `http://`
        # в разборе. Без подстановки `urlsplit` не даёт хоста вовсе, и локальная
        # цель получила бы ложный отказ (чужая отвергается и так — замечание
        # ревью, моё прежнее обоснование было перевёрнуто).
        "localhost:8001",
        # Хвостовая точка — то же имя для DNS, но другая строка для сравнения;
        # без нормализации локальная цель получила бы ложный отказ.
        "http://localhost.:5175",
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
        # Локальное имя ВНУТРИ чужого домена. Сравнение по вхождению вместо
        # сверки разобранного хоста пропустило бы такую цель — ровно тот класс,
        # из-за которого переписывали первую редакцию (там ловили «railtech»
        # подстрокой).
        ("https://localhost.railtech.uz", "локальный хост подстрокой чужого"),
        # `nip.io` резолвится в 127.0.0.1 — то есть это петля через ЧУЖОЕ имя.
        # Отвергается правильно: сверяется имя, а не то, куда оно разрешается;
        # кому нужен локальный TLS через такой домен, подтверждает целью.
        ("https://127.0.0.1.nip.io", "чужое имя с локальным адресом внутри"),
        # Граница «точное совпадение, а не суффикс»: с `endswith` вместо
        # равенства чужое имя, оканчивающееся локальным, прошло бы мимо.
        ("http://notlocalhost:8001", "чужое имя, оканчивающееся локальным"),
        # С подстановкой хост разбирается как `app.example.com`, без неё — хоста
        # нет вовсе; в белом списке нет ни того, ни другого, поэтому цель
        # отвергается в обоих случаях. Значит случай закрепляет сверку с белым
        # списком, а НЕ подстановку схемы (её держит `localhost:8001` среди
        # проходящих). Объяснение здесь переписывается третий раз: дважды я
        # называл механизм, которого в нынешнем коде нет.
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


class NetworkTouched(Exception):
    """Профиль полез в сеть. Для чужой цели это провал, а не деталь."""


def _load_profile(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    """Загрузить профиль с поддельными зависимостями.

    Косвенные проверки по исходнику (подстрока, а потом дамп дерева) раз за
    разом оказывались слабее, чем обещали: мимо них проходили `if False:`,
    подменённый аргумент и смена типа исключения в обработчике. Довод «locust и
    requests нет в окружении» стоит двух десятков строк подделки — а взамен
    проверяется настоящая цепочка: подписан → отказал → `StopTest` → сети не
    было (замечание ревью PR #198).
    """

    class _Event:
        def __init__(self) -> None:
            self.listeners: list[object] = []

        def add_listener(self, handler):  # type: ignore[no-untyped-def]
            self.listeners.append(handler)
            return handler

    class _Events:
        def __init__(self) -> None:
            self.test_start = _Event()

    class _StopTest(Exception):
        pass

    def _network(*args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        raise NetworkTouched(args[0] if args else "")

    locust = ModuleType("locust")
    locust.HttpUser = type("HttpUser", (), {})  # type: ignore[attr-defined]
    locust.between = lambda *a, **k: None  # type: ignore[attr-defined]
    locust.task = lambda *a, **k: a[0] if a and callable(a[0]) else (lambda fn: fn)  # type: ignore[attr-defined]
    locust.events = _Events()  # type: ignore[attr-defined]
    exception = ModuleType("locust.exception")
    exception.StopTest = _StopTest  # type: ignore[attr-defined]
    locust.exception = exception  # type: ignore[attr-defined]
    requests = ModuleType("requests")
    requests.post = _network  # type: ignore[attr-defined]
    requests.get = _network  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "locust", locust)
    monkeypatch.setitem(sys.modules, "locust.exception", exception)
    monkeypatch.setitem(sys.modules, "requests", requests)
    monkeypatch.syspath_prepend(str(_LOAD))

    spec = importlib.util.spec_from_file_location("locustfile_under_test", _PROFILE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module, locust.events, _StopTest  # type: ignore[attr-defined]


def test_foreign_target_stops_the_run_before_any_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Настоящая цепочка: подписка, отказ, остановка, сеть не тронута.

    Одна проверка вместо четырёх косвенных. Она ловит и снятый декоратор
    (список слушателей пуст), и подменённый аргумент, и `if False:`, и смену
    типа исключения в обработчике, и перенос защиты за вход — тогда вместо
    остановки случилась бы `NetworkTouched`.
    """
    module, events, stop_test = _load_profile(monkeypatch)
    assert events.test_start.listeners, "подготовка прогона не подписана на старт"

    for handler in events.test_start.listeners:
        with pytest.raises(stop_test):
            handler(environment=SimpleNamespace(host=STAND))


def test_allowed_target_reaches_the_login(monkeypatch: pytest.MonkeyPatch) -> None:
    """Обратная сторона: с подтверждением прогон идёт дальше.

    Без этого случая «отказывать всегда» выглядело бы исправной защитой.
    """
    module, events, stop_test = _load_profile(monkeypatch)
    # Цикл по пустому списку проходит молча: без этой строки тест был бы
    # вакуумным и при снятом декораторе остался бы зелёным.
    assert events.test_start.listeners, "подготовка прогона не подписана на старт"
    monkeypatch.setenv(PROFILE.ALLOW_TARGET, STAND)

    for handler in events.test_start.listeners:
        with pytest.raises(NetworkTouched):
            handler(environment=SimpleNamespace(host=STAND))


def test_local_target_reaches_the_login(monkeypatch: pytest.MonkeyPatch) -> None:
    module, events, stop_test = _load_profile(monkeypatch)
    assert events.test_start.listeners, "подготовка прогона не подписана на старт"

    for handler in events.test_start.listeners:
        with pytest.raises(NetworkTouched):
            handler(environment=SimpleNamespace(host=LOCAL))


def test_permission_must_equal_the_target(monkeypatch: pytest.MonkeyPatch) -> None:
    # Разрешение сравнивается ЦЕЛИКОМ: при сравнении по вхождению
    # `LOAD_ALLOW_TARGET=uz` открыл бы любой адрес в этой зоне.
    monkeypatch.setenv(PROFILE.ALLOW_TARGET, "uz")
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target(STAND)


def test_unparsable_target_is_refused() -> None:
    # Пустой хост разрешён только для буквально пустой цели: `//evil.com` хоста
    # не даёт, и прежняя редакция пропускала такую строку — fail-open.
    with pytest.raises(RuntimeError):
        PROFILE.refuse_foreign_target("//evil.com")
