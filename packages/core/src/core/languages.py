"""Языки семейных каналов — бота и Mini App (решение заказчика G3, ADR-0052).

Язык — свойство человека, а не чата и не устройства: его читают бот, Mini App
и рассылки воркера, и все трое обязаны говорить с человеком одинаково. Поэтому
он хранится в `users.language`, а не в Redis бота и не в памяти вкладки.

Кабинет в браузере остаётся русским: язык здесь — только семейных каналов.
"""

from __future__ import annotations

from typing import Final, Literal

#: Узбекский — латиницей, как на посадочной странице (`packages/landing`) и как
#: требует действующая орфография. Кириллица отложена (ADR-0052).
Language = Literal["ru", "uz"]

LANGUAGES: Final[tuple[Language, ...]] = ("ru", "uz")
DEFAULT_LANGUAGE: Final[Language] = "ru"


def from_telegram(language_code: str | None) -> Language:
    """Язык по умолчанию из `language_code` клиента Telegram.

    Узбекский интерфейс Telegram (`uz`, бывает и `uz-UZ`) — узбекский, всё
    остальное — русский: второй язык семей в Узбекистане и язык клиники.
    Английский интерфейс у узбекской семьи — частый случай, и русский ей
    понятнее английского, которого у нас нет.
    """

    if not language_code:
        return DEFAULT_LANGUAGE
    return "uz" if language_code.strip().lower().split("-")[0] == "uz" else DEFAULT_LANGUAGE


def known_or_none(stored: str | None) -> Language | None:
    """Сохранённый язык как значение из списка — или None, если не выбран."""

    if stored == "uz":
        return "uz"
    if stored == "ru":
        return "ru"
    return None


def effective(stored: str | None) -> Language:
    """Язык для сообщения человеку: сохранённый или русский, если не сохранён."""

    return "uz" if stored == "uz" else DEFAULT_LANGUAGE
