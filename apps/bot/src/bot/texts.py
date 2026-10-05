"""Тексты бота на языке человека, приславшего сообщение (ADR-0052).

Сами строки — в `texts_ru.py` и `texts_uz.py`, с одинаковыми именами. Этот
модуль своих строк не держит: `texts.SAVED` отдаёт строку того каталога, язык
которого выбран для текущего обновления (`i18n.current()`). Поэтому
обработчики, общие шаги и клавиатуры пишут `texts.X`, как и прежде, и
ни один из них не может забыть про язык.

Вне обработки обновления (тесты, импорт) язык — русский.

Фильтры кнопок вычисляются при импорте, когда языка ещё нет: они берут
`i18n.variants("BTN_…")` — подпись на всех языках, а не `texts.BTN_…`.
"""

from __future__ import annotations

from typing import Any

from . import i18n


def __getattr__(name: str) -> Any:
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(i18n.catalog(), name)


def __dir__() -> list[str]:
    return [name for name in dir(i18n.catalog()) if not name.startswith("_")]
