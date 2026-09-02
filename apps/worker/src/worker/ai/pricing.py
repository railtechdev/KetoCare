"""Прайс-лист моделей: сколько стоил вызов (раздел 10.2 ТЗ).

Стоимость нужна не для отчётности, а для предохранителя: дневной бюджет
проекта считается по сумме уже записанных вызовов, и без цены он не работает.

Цены — из официального прайса Anthropic, долларов за миллион токенов, сверено
на **2026-06-24**. В окружении их нет намеренно: переменная, которую забыли
обновить, — это неверная сумма, а неверная сумма отключает бюджет молча. Модель,
которой в списке нет, стоит `None`: цена не выдумывается, а вызов не
запрещается — по журналу видно, что сумма по нему неизвестна.
"""

from __future__ import annotations

import re
from decimal import Decimal

#: Модель → (вход, выход) в долларах за миллион токенов.
PRICES_USD_PER_MTOK: dict[str, tuple[Decimal, Decimal]] = {
    "claude-fable-5": (Decimal("10"), Decimal("50")),
    "claude-opus-5": (Decimal("5"), Decimal("25")),
    "claude-opus-4-8": (Decimal("5"), Decimal("25")),
    "claude-opus-4-7": (Decimal("5"), Decimal("25")),
    "claude-opus-4-6": (Decimal("5"), Decimal("25")),
    "claude-sonnet-5": (Decimal("2"), Decimal("10")),
    "claude-sonnet-4-6": (Decimal("3"), Decimal("15")),
    "claude-haiku-4-5": (Decimal("1"), Decimal("5")),
}

_MTOK = Decimal("1000000")

# Датированный снимок модели («claude-haiku-4-5-20251001») стоит столько же,
# сколько сама модель. Без обрезания даты такой идентификатор не находился бы в
# прайсе, и бюджет переставал бы считать — а именно датированное имя стоит в
# `.env.example`.
_DATE_SUFFIX = re.compile(r"-\d{8}$")


def base_model(model: str) -> str:
    return _DATE_SUFFIX.sub("", model.strip())


def estimate_cost(model: str, *, tokens_in: int | None, tokens_out: int | None) -> Decimal | None:
    """Стоимость вызова в долларах или `None`, если цена модели неизвестна."""

    price = PRICES_USD_PER_MTOK.get(base_model(model))
    if price is None or tokens_in is None or tokens_out is None:
        return None

    price_in, price_out = price
    return (price_in * Decimal(tokens_in) + price_out * Decimal(tokens_out)) / _MTOK
