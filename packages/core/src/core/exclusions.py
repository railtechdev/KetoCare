"""Что ребёнку нельзя: разбор поля `patients.allergies`.

Раздел 4.2 ТЗ описывает поле как «список строк-идентификаторов продуктов и
свободных меток». Так оно и хранится, но пользовались им только как свободным
текстом: строка разбивалась по запятой и показывалась в карточке. Сопоставить
её с продуктом было невозможно даже в принципе — а значит, ни подбор раскладки,
ни составление меню об исключениях не знали. Ребёнку с аллергией на орехи
решатель мог предложить арахис.

Здесь одно место, где строка превращается в смысл: идентификатор продукта или
свободная метка. Второе такое место однажды разошлось бы с первым, и часть
системы считала бы исключение меткой, а часть — продуктом.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence


def parse(allergies: Iterable[str]) -> tuple[set[uuid.UUID], list[str]]:
    """Делит список на идентификаторы продуктов и свободные метки.

    Порядок меток сохраняется: их показывают человеку, а порядок в карточке
    задаёт тот, кто её заполнял.
    """

    products: set[uuid.UUID] = set()
    labels: list[str] = []

    for entry in allergies:
        value = entry.strip()
        if not value:
            continue
        try:
            products.add(uuid.UUID(value))
        except ValueError:
            labels.append(value)

    return products, labels


def excluded_ids(allergies: Iterable[str]) -> set[uuid.UUID]:
    """Только продукты: свободные метки сопоставить с каталогом нечем."""

    return parse(allergies)[0]


def contains_excluded(
    product_ids: Sequence[uuid.UUID], allergies: Iterable[str]
) -> list[uuid.UUID]:
    """Какие из продуктов состава ребёнку исключены — в порядке состава."""

    excluded = excluded_ids(allergies)
    return [pid for pid in dict.fromkeys(product_ids) if pid in excluded]
