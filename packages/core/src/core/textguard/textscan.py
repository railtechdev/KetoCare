"""Примитивы разбора текста для постфильтров (`guard.py`, `summary_guard.py`).

Отдельный модуль появился, когда фильтров стало два. Правила у них разные —
помощник защищает семью от совета, сводка защищает врача от чужого суждения, —
но нормализация и поиск признаков у обоих одни и те же, а вторая копия
нормализации однажды разойдётся с первой и тихо перестанет ловить `**300 мг**`.
"""

from __future__ import annotations

import re

_SENTENCE_END = frozenset(".!?")


def _split_sentences(text: str) -> list[str]:
    """Режет текст по концам предложений — так же, как прежнее выражение.

    Конец предложения — серия «.», «!», «?», за которой пробел или конец
    текста, либо серия переводов строки. После цифры первый знак серии
    остаётся числу: «10. мая» не режется, «10.! » режется со второго знака.

    Раньше это было `re.split(r"(?<![\\d])[.!?]+(?=\\s|$)|\\n+", text)`. Оно
    пробовало каждую позицию серии заново и на строке из тысяч «!» без пробела
    после работало квадратично (CodeQL py/polynomial-redos; текст присылает
    семья). Здесь серия проходится один раз. Разбиение то же самое — его держит
    `test_sentence_split_matches_the_previous_rule`: фильтр сводит признаки
    внутри предложения, и другой разрез поменял бы вердикты.
    """

    parts: list[str] = []
    start = 0
    i = 0
    n = len(text)
    while i < n:
        char = text[i]
        if char == "\n":
            end = i
            while end < n and text[end] == "\n":
                end += 1
            parts.append(text[start:i])
            start = i = end
            continue
        if char in _SENTENCE_END:
            end = i
            while end < n and text[end] in _SENTENCE_END:
                end += 1
            # `\d` и `\s` выражения — это `isdecimal` и `isspace` строки.
            cut = i + 1 if i > 0 and text[i - 1].isdecimal() else i
            if cut < end and (end == n or text[end].isspace()):
                parts.append(text[start:cut])
                start = end
            i = end
            continue
        i += 1
    parts.append(text[start:])
    return parts


def normalize(text: str) -> str:
    """Нижний регистр, «ё» как «е», разметка снята.

    Без этого `**300 мг**` и «Мг» проходили бы мимо: модель форматирует ответ, а
    фильтр смотрит на буквы.
    """

    lowered = text.lower().replace("ё", "е")
    without_markup = re.sub(r"[*_`#>]+", " ", lowered)
    # Знаки внутри предложения — пробел: «следует, повторить анализ» иначе
    # проходил мимо признака «следует повторить», и одна запятая снимала
    # запрет (находка ревью, 05.10.2026). Словарь нормализуется так же
    # (`find_any`), поэтому «вероятно, это» в нём по-прежнему совпадает.
    without_punctuation = re.sub(r"[,;:()«»\"“”„]+", " ", without_markup)
    return re.sub(r"\s+", " ", without_punctuation)


def find_any(text: str, needles: tuple[str, ...]) -> str | None:
    for needle in needles:
        if normalize(needle).strip() in text:
            return needle
    return None


def sentences(text: str) -> list[str]:
    """Текст по предложениям — единица проверки для длинных документов.

    Помощник отвечает двумя-четырьмя предложениями, и там разницы нет. Сводка —
    шесть разделов, и правило «признак А рядом с признаком Б» на целом документе
    срабатывает случайно: «судороги 14.08» из одного раздела склеивается с «из-за
    поездки» из другого, хотя обе строки безобидны.

    Нормализация — на каждом предложении, не на тексте целиком: иначе строки
    склеятся ещё до разбиения.
    """

    parts = (normalize(part) for part in _split_sentences(text) if part)
    return [part for part in (part.strip() for part in parts) if part]
