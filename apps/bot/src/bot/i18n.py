"""Язык бота (ADR-0052, решение заказчика G3).

Язык — свойство человека и хранится на сервере (`users.language`): бот, Mini
App и рассылки воркера обязаны говорить с ним одинаково. Бот держит его копию
в Redis на несколько минут (`BindingStore.language`), чтобы не спрашивать
сервер на каждое сообщение, а на время обработки одного обновления кладёт его
в `ContextVar` — оттуда его читает `bot.texts`.

Почему переменная контекста, а не параметр в каждом обработчике: текст берут
не только обработчики, но и общие шаги (`deps.submit_log`, `deps.menu`,
клавиатуры). Протаскивать язык через каждый вызов значило бы однажды забыть
его в одном из них — и семья получила бы русскую строку посреди узбекского
сценария. aiogram обрабатывает каждое обновление в своей задаче, и значение
одной задачи не видно другой.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from types import ModuleType
from typing import Final, Literal

from . import texts_ru, texts_uz

Language = Literal["ru", "uz"]

LANGUAGES: Final[tuple[Language, ...]] = ("ru", "uz")
DEFAULT_LANGUAGE: Final[Language] = "ru"

#: Название языка — на самом этом языке, как в переключателях my.gov.uz:
#: человек ищет «O‘zbekcha», а не «Узбекский», который ещё надо прочитать.
LANGUAGE_LABELS: Final[dict[Language, str]] = {"ru": "Русский", "uz": "O‘zbekcha"}

CATALOGS: Final[dict[Language, ModuleType]] = {"ru": texts_ru, "uz": texts_uz}

_current: ContextVar[Language] = ContextVar("bot_language", default=DEFAULT_LANGUAGE)


def known(value: object) -> Language | None:
    """Значение как язык из списка — или None для незнакомого и пустого."""

    if value == "uz":
        return "uz"
    if value == "ru":
        return "ru"
    return None


def from_telegram(language_code: str | None) -> Language:
    """Умолчание по языку клиента Telegram: узбекский — узбекский, прочее — русский.

    То же правило, что у сервера (`core.languages.from_telegram`); бот от `core`
    не зависит и держит две строки у себя.
    """

    if not language_code:
        return DEFAULT_LANGUAGE
    return "uz" if language_code.strip().lower().split("-")[0] == "uz" else DEFAULT_LANGUAGE


def current() -> Language:
    return _current.get()


@contextmanager
def use(language: Language) -> Iterator[None]:
    """Язык на время блока: обработка одного обновления или шаг теста."""

    token = _current.set(language)
    try:
        yield
    finally:
        _current.reset(token)


def switch(language: Language) -> None:
    """Сменить язык до конца обработки текущего обновления.

    Нужен ровно одному месту — выбору языка: подтверждение уходит уже на новом.
    Значение живёт в контексте задачи обновления и после неё не остаётся.
    """

    _current.set(language)


def catalog(language: Language | None = None) -> ModuleType:
    return CATALOGS[language or current()]


def variants(name: str) -> tuple[str, ...]:
    """Строка `name` на всех языках — для фильтров кнопок.

    Кнопку нажимают с клавиатуры, отправленной раньше, — возможно, ещё на
    прежнем языке. Фильтр обязан узнать её на любом.
    """

    return tuple(dict.fromkeys(str(getattr(module, name)) for module in CATALOGS.values()))
