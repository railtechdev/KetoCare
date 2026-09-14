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
import re
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        # Ключ свой у каждого файла тестов: под общим два разных объекта
        # модуля жили бы в `sys.modules` под одним именем.
        f"{name}_for_demo_tests",
        _SCRIPTS / f"{name}.py",
    )
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
    # И пароль: заданное снаружи значение сделало бы проверку ниже неправдой.
    monkeypatch.delenv(DEMO._PASSWORD_VAR, raising=False)


def test_local_database_passes() -> None:
    DEMO._refuse_production(LOCAL)


def test_foreign_database_is_refused() -> None:
    with pytest.raises(SystemExit) as refusal:
        DEMO._refuse_production(FOREIGN)
    # Отказ обязан называть опасность ЭТОГО скрипта, а не общую: человек на
    # сервере читает сообщение, а не исходник.
    assert "второй фактор" in str(refusal.value)
    assert "админка" in str(refusal.value)
    # Необратимое называется отдельно: пароль и второй фактор поправимы, а
    # назначение — нет (append-only, снимается только `erase_patient`).
    assert "append-only" in str(refusal.value)


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


def test_password_is_required_when_the_host_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    # Разрешение открывает нелокальную базу — значит пароль из репозитория там
    # недопустим. Это правило жило только во фразе документа.
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    with pytest.raises(SystemExit) as refusal:
        DEMO._require_password_on_allowed_host()
    assert DEMO._PASSWORD_VAR in str(refusal.value)


def test_password_given_satisfies_the_requirement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    # Длиннее минимума: «свой пароль» — одиннадцать символов, и после появления
    # правила длины этот случай проверял бы уже не то, что заявляет.
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "свой длинный пароль")
    DEMO._require_password_on_allowed_host()


def test_local_run_does_not_require_a_password() -> None:
    # На локальной базе умолчание — удобство: `make seed-demo` ломать незачем.
    DEMO._require_password_on_allowed_host()


def test_blank_password_does_not_count(monkeypatch: pytest.MonkeyPatch) -> None:
    # Пустое значение — это незаданное значение, а не «задал пустой пароль».
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "   ")
    with pytest.raises(SystemExit):
        DEMO._require_password_on_allowed_host()


def test_password_requirement_is_wired_into_main(monkeypatch: pytest.MonkeyPatch) -> None:
    """Требование обязано быть ВЫЗВАНО, а не просто написано.

    Тот же урок, что с проверкой адреса: сама по себе функция ничего не стоит,
    пока её не зовут, и снятие вызова не ловилось бы ничем.
    """
    calls: list[str] = []

    class _Stop(Exception):
        pass

    def _settings() -> SimpleNamespace:
        return SimpleNamespace(database_url=LOCAL)

    def _engine(database_url: str) -> None:
        calls.append("engine")
        raise _Stop

    monkeypatch.setattr(DEMO, "get_settings", _settings)
    monkeypatch.setattr(DEMO, "_refuse_production", lambda url: calls.append("guard"))
    monkeypatch.setattr(DEMO, "_require_password_on_allowed_host", lambda: calls.append("password"))
    monkeypatch.setattr(DEMO, "create_async_engine", _engine)

    with pytest.raises(_Stop):
        asyncio.run(DEMO.main())

    assert calls == ["guard", "password", "engine"]


def test_given_password_is_not_printed(monkeypatch: pytest.MonkeyPatch) -> None:
    # Обещание безопасности из docs/DEPLOY.md обязано быть проверяемым: на
    # стенде вывод уходит в консоль и журнал команды.
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "очень свой пароль")
    line = DEMO._password_line()
    assert "очень свой пароль" not in line
    assert DEMO._PASSWORD_VAR in line


def test_default_password_is_printed_locally() -> None:
    # На своей машине пароль печатать нужно: иначе войти в демо-кабинет нечем.
    assert DEMO._PASSWORD_DEFAULT in DEMO._password_line()


def test_password_used_is_the_one_checked(monkeypatch: pytest.MonkeyPatch) -> None:
    # Значение читается в момент обращения, а не снимается при импорте: иначе
    # проверка удостоверяет одно, а хешируется другое.
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "  заданный  ")
    assert DEMO._demo_password() == "заданный"
    monkeypatch.delenv(DEMO._PASSWORD_VAR, raising=False)
    assert DEMO._demo_password() == DEMO._PASSWORD_DEFAULT


def test_main_refuses_without_password_on_allowed_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """Сквозной отказ настоящими функциями, без подмен проверок.

    Остальные тесты зовут проверку напрямую, а связочный её подменяет — то есть
    ни один не показывает, что `main()` ДЕЙСТВИТЕЛЬНО прерывается до базы.
    Замечание ревью PR #195.
    """

    class _Stop(Exception):
        pass

    def _engine(database_url: str) -> None:
        raise _Stop

    monkeypatch.setattr(DEMO, "get_settings", lambda: SimpleNamespace(database_url=LOCAL))
    monkeypatch.setattr(DEMO, "create_async_engine", _engine)
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")

    with pytest.raises(SystemExit) as refusal:
        asyncio.run(DEMO.main())
    assert DEMO._PASSWORD_VAR in str(refusal.value)


def test_checked_password_is_the_one_hashed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Проверенное значение обязано быть тем самым, которое хешируется.

    Мутация из разбора: заменить `_demo_password()` на зашитое умолчание в
    месте применения. Тест значения её не ловил — он проверял функцию, а не
    связь функции с местом, где пароль превращается в хеш. Ровно тот же класс,
    что «правило написано, но не вызвано».
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

    monkeypatch.setattr(DEMO, "users_repo", _Users)
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "пароль со стенда")

    asyncio.run(
        DEMO._user(
            None,
            DEMO.UserRole.ADMIN,
            "Админ Демо",
            "admin@example.com",
            lambda value: f"hash:{value}",
        )
    )

    assert written["password_hash"] == "hash:пароль со стенда"


def test_default_value_does_not_count_as_given(monkeypatch: pytest.MonkeyPatch) -> None:
    """Умолчание из репозитория — это НЕ заданный пароль.

    Скопированное в команду, оно защищает ровно так же, как незаданная
    переменная, то есть никак. У сида прогонов закрыто в #196.
    """
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    monkeypatch.setenv(DEMO._PASSWORD_VAR, DEMO._PASSWORD_DEFAULT)
    with pytest.raises(SystemExit) as refusal:
        DEMO._require_password_on_allowed_host()
    assert DEMO._PASSWORD_VAR in str(refusal.value)


def test_copied_default_is_not_called_given_in_the_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Обещание «заданный пароль не печатается» не должно превращаться в
    # «умолчание объявлено переменной, значит его не видно»: это неправда, и
    # человек решил бы, что пароль в журнал не попал.
    monkeypatch.setenv(DEMO._PASSWORD_VAR, DEMO._PASSWORD_DEFAULT)
    assert DEMO._PASSWORD_DEFAULT in DEMO._password_line()


def test_patient_without_a_row_is_recreated(monkeypatch: pytest.MonkeyPatch) -> None:
    """Привязка без строки пациента — не повод падать.

    `patients_repo.get` по типу отдаёт `Patient | None`. Сегодня пусто здесь не
    бывает: внешний ключ не даёт привязке пережить пациента, а `erase_patient`
    чистит привязки раньше. Но ветки не было вовсе, и значение уходило прямо в
    `patient.id` — проверка типов (`union-attr`) на это и указала, когда каталог
    заводили под `mypy`. Ветка защитная, и тест держит именно её поведение:
    пусто значит «заводим нового и привязываем к родителю».
    """
    created: list[str] = []
    linked_parents: list[tuple[str, str]] = []

    class _Access:
        @staticmethod
        async def list_accessible_patient_ids(session: object, **kw: object) -> list[str]:
            return ["id-удалённого"]

    class _Patients:
        @staticmethod
        async def get(session: object, patient_id: str) -> None:
            return None

        @staticmethod
        async def create(session: object, **fields: object) -> SimpleNamespace:
            created.append(str(fields.get("full_name")))
            return SimpleNamespace(id="id-нового")

        @staticmethod
        async def link_parent(session: object, **kw: object) -> None:
            linked_parents.append((str(kw.get("parent_id")), str(kw.get("patient_id"))))

        @staticmethod
        async def link_doctor(session: object, **kw: object) -> None:
            return None

    monkeypatch.setattr(DEMO, "access_repo", _Access)
    monkeypatch.setattr(DEMO, "patients_repo", _Patients)

    patient = asyncio.run(
        DEMO._patient(
            None,
            parent=SimpleNamespace(id="id-родителя"),
            doctor=SimpleNamespace(id="id-врача"),
        )
    )

    assert patient.id == "id-нового"
    assert created == ["Аня Иванова"]
    # Нового ребёнка мало: без привязки к родителю демо-сид бесполезен ровно так
    # же, как при падении. Мутация «снять `link_parent`» иначе выживает.
    assert linked_parents == [("id-родителя", "id-нового")]


def test_short_password_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """Короткий пароль на разрешённой базе — та же открытая админка.

    `create_admin.py` требует двенадцать символов при точно такой же экспозиции
    (`admin@example.com` на публичном домене), а сторож демо-сида пропускал
    любой — замечание ревью PR #197.
    """
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "коротко")
    with pytest.raises(SystemExit) as refusal:
        DEMO._require_password_on_allowed_host()
    assert str(DEMO.MIN_PASSWORD_LENGTH) in str(refusal.value)
    assert "админка" in str(refusal.value)


def test_password_of_minimum_length_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    # Граница: ровно минимум проходит. Со строгим `<=` вместо `<` этот случай
    # упал бы — мутация на нём и проверяется.
    monkeypatch.setenv(DEMO._ALLOW_HOST, "postgres")
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "x" * DEMO.MIN_PASSWORD_LENGTH)
    DEMO._require_password_on_allowed_host()


def test_local_run_does_not_check_length(monkeypatch: pytest.MonkeyPatch) -> None:
    # На локальной базе длина не проверяется вовсе: там умолчание — удобство, и
    # ломать `make seed-demo` незачем.
    #
    # Пароль задаётся КОРОТКИЙ намеренно: без него тест был вакуумным —
    # умолчание длиной в двадцать восемь символов проходит любую проверку, и
    # мутация «требовать длину и локально» оставляла его зелёным.
    monkeypatch.setenv(DEMO._PASSWORD_VAR, "abc")
    DEMO._require_password_on_allowed_host()


def test_length_comes_from_one_place() -> None:
    """Число у сида берётся из общего модуля, а не объявлено заново.

    Сравнивать значения бесполезно: `12 is 12` истинно и у независимых
    объявлений — малые целые в Python кэшируются, и первая редакция этого теста
    переживала мутацию «объявить своё число». Поэтому проверяется ИСХОДНИК:
    собственного присваивания у сида быть не должно, только импорт из общего
    модуля. То же свойство `create_admin.py` проверяет его собственный тест — и
    по дереву разбора: копия под другим именем регулярку проходит (ревью #201).
    """
    from core.tools.db_guard import MIN_PASSWORD_LENGTH as shared

    assert shared == DEMO.MIN_PASSWORD_LENGTH

    for script in ("seed_demo.py",):
        source = (_SCRIPTS / script).read_text(encoding="utf8")
        # Регулярка, а не подстрока: `MIN_PASSWORD_LENGTH: int = 12` мимо
        # подстроки проходил, и аннотированная копия оставалась незамеченной —
        # то есть заготовка будущего расхождения.
        assert re.search(r"^MIN_PASSWORD_LENGTH\s*(:[^=]+)?=", source, re.M) is None, (
            f"{script} объявляет минимум длины сам — копия разойдётся молча, "
            "как уже расходилась проверка адреса базы"
        )
