"""«Сегодня» считается по поясу клиники — и в приложении, и в миграциях.

Проверка появилась после разбора: правило существовало в коде и не удерживалось
ничем. Мутация «считать в UTC» не роняла ни одного из 149 тестов, потому что все
они берут «сегодня» у той же функции и сдвигаются вместе с ней. Здесь ожидаемое
значение названо независимо — по известному моменту и известному поясу.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from core.clock import asyncpg_connect_args, local_today
from core.config import get_settings

TASHKENT = ZoneInfo("Asia/Tashkent")


def _freeze(monkeypatch: pytest.MonkeyPatch, moment: datetime) -> None:
    """Подменяет `datetime` в `core.clock`, сохраняя работу с поясами.

    Именно `now(tz)`, а не готовая дата: тест обязан различать `now(UTC).date()`
    и `now(ZoneInfo(settings.tz)).date()`, а это видно только по аргументу.
    """

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz: object = None) -> datetime:  # type: ignore[override]
            return moment.astimezone(tz) if tz is not None else moment  # type: ignore[arg-type]

    monkeypatch.setattr("core.clock.datetime", _Frozen)


def test_night_in_tashkent_belongs_to_its_own_day(monkeypatch: pytest.MonkeyPatch) -> None:
    """03:00 по Ташкенту — это уже сегодня, хотя в UTC ещё вчера.

    Тот самый край, ради которого пояс и берётся из настроек: по UTC-дате ответ,
    данный в ночь начала терапии, посчитался бы данным накануне, а исходная
    частота приступов записалась бы там, где записывать её нельзя.
    """

    moment = datetime(2026, 3, 1, 3, 0, tzinfo=TASHKENT)
    assert moment.astimezone(ZoneInfo("UTC")).date() == date(2026, 2, 28), (
        "предпосылка теста исчезла — пояс клиники перестал опережать UTC"
    )

    _freeze(monkeypatch, moment)

    assert local_today() == date(2026, 3, 1)


def test_late_evening_is_not_tomorrow(monkeypatch: pytest.MonkeyPatch) -> None:
    """Обратный край: 23:30 по Ташкенту — это ещё сегодня.

    Без этого случая правило прошло бы и с «прибавить сутки к UTC-дате»: семья
    поздним вечером увидела бы пустой «завтрашний» день вместо своих итогов.
    """

    _freeze(monkeypatch, datetime(2026, 3, 1, 23, 30, tzinfo=TASHKENT))

    assert local_today() == date(2026, 3, 1)


def test_migrations_ask_for_the_same_timezone() -> None:
    """Пояс соединения миграций — тот же `settings.tz`, что у приложения.

    Разойдись они — миграция и `upsert` назвали бы разные сутки одним днём.
    """

    assert asyncpg_connect_args() == {"server_settings": {"timezone": get_settings().tz}}


def test_migration_env_actually_asks_for_it() -> None:
    """`migrations/env.py` берёт пояс отсюда, а не задаёт свой.

    Проверка по исходнику, потому что `env.py` исполняется только под alembic и
    импортировать его нельзя. Без неё правило не удерживается ничем: удаление
    строки не роняло ни `alembic upgrade`, ни `alembic check`, ни весь
    `packages/core` — а на стенде давало неверно посчитанные клинические данные,
    которые по результату не отличить от верных.
    """

    env_py = Path(__file__).resolve().parents[1] / "migrations" / "env.py"
    source = env_py.read_text(encoding="utf-8")

    assert "asyncpg_connect_args" in source, (
        "migrations/env.py перестал брать пояс из core.clock — "
        "миграции пойдут в поясе сервера (в контейнере это UTC)"
    )
    assert "connect_args=asyncpg_connect_args()" in source
