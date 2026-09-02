"""Прайс-лист моделей: сколько стоил вызов (раздел 10.2 ТЗ).

Стоимость нужна не для отчётности, а для предохранителя: дневной бюджет
проекта считается по сумме уже записанных вызовов, и без цены он не работает.

Цены — из официального прайса Anthropic <https://platform.claude.com/docs/en/pricing>,
долларов за миллион токенов, сверено на **2026-06-24**. В окружении их нет
намеренно: переменная, которую забыли обновить, — это неверная сумма, а неверная
сумма отключает бюджет молча.

**Модель, которой нет в этой таблице, работать не будет** — `assert_priced`
отказывает на сборке клиента. Это выбрано сознательно: неизвестная цена
означала бы `cost_usd IS NULL`, сумма за день считалась бы нулём, и дневной
бюджет не срабатывал бы НИКОГДА — от одной опечатки в `.env`, без единого
сообщения. Лучше отказ при запуске, чем предохранитель, который выглядит
настроенным. Меняете модель в `.env` — добавьте её цену сюда, сверив с прайсом.
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

# Датированный снимок модели («claude-haiku-4-5-20251001») и алиас «-latest»
# стоят столько же, сколько сама модель. Без обрезания такой идентификатор не
# находился бы в прайсе — а именно датированное имя стоит в `.env.example`.
_ALIAS_SUFFIX = re.compile(r"(-\d{8}|-latest)$")


class UnknownModelPrice(LookupError):
    """Цены модели нет в таблице — считать бюджет нечем."""


def base_model(model: str) -> str:
    return _ALIAS_SUFFIX.sub("", model.strip())


def is_priced(model: str) -> bool:
    return base_model(model) in PRICES_USD_PER_MTOK


def assert_priced(model: str, *, variable: str) -> None:
    """Отказать, если модель без цены. Вызывается до первого обращения к ней."""

    if not is_priced(model):
        raise UnknownModelPrice(
            f"Модель «{model}» из {variable} не найдена в прайс-листе "
            f"(worker/ai/pricing.py). Без цены дневной бюджет не считается вовсе — "
            f"добавьте цену модели, сверив с https://platform.claude.com/docs/en/pricing."
        )


def estimate_cost(model: str, *, tokens_in: int | None, tokens_out: int | None) -> Decimal | None:
    """Стоимость вызова в долларах или `None`, если считать нечего.

    `None` возвращается там, где нет самих токенов: ответ, у которого нет
    `usage`. Неизвестная модель сюда не доходит — её отсекает `assert_priced`.
    """

    price = PRICES_USD_PER_MTOK.get(base_model(model))
    if price is None or tokens_in is None or tokens_out is None:
        return None

    price_in, price_out = price
    return (price_in * Decimal(tokens_in) + price_out * Decimal(tokens_out)) / _MTOK


def reserve_cost(model: str, *, max_tokens: int, prompt_tokens_guess: int) -> Decimal | None:
    """Верхняя оценка стоимости — списывается в бюджет ДО вызова.

    Зачем: строка со статусом `RUNNING` живёт до конца вызова, и пока она живёт,
    её стоимость неизвестна. Без оценки одновременные задачи читают одну и ту же
    сумму «потрачено» и проходят предохранитель все разом, а оборванный вызов
    (упал процесс) не попадает в бюджет никогда.

    Оценка заведомо завышена: считается по потолку ответа, хотя модель обычно
    отвечает короче. Завышенная оценка задержит лишний вызов, заниженная —
    пропустит перерасход; из двух ошибок дешевле первая.
    """

    return estimate_cost(model, tokens_in=prompt_tokens_guess, tokens_out=max_tokens)
