"""Price suggestions for a model the administrator adds (ADR-0082).

LiteLLM ships a map of public prices. It is read here as a file, without
importing the package: the API only needs two numbers to prefill a form, and
importing LiteLLM costs seconds and memory in every API process.

A suggestion is a hint, never the price that is charged: the administrator
sees it in the form, may correct it, and what is stored in the catalogue is
what the budget counts by.
"""

from __future__ import annotations

import importlib.util
import json
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

_MAP_FILE = "model_prices_and_context_window_backup.json"
_MTOK = Decimal("1000000")


@lru_cache(maxsize=1)
def _price_map() -> dict[str, Any]:
    spec = importlib.util.find_spec("litellm")
    if spec is None or spec.origin is None:
        return {}
    try:
        loaded = json.loads((Path(spec.origin).parent / _MAP_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def suggest_price(route: str, model: str) -> tuple[Decimal, Decimal] | None:
    """Dollars per million tokens (input, output) or `None` when unknown."""

    prices = _price_map()
    for name in (f"{route}/{model}", model):
        entry = prices.get(name)
        if not isinstance(entry, dict):
            continue
        # A bare name is someone's model: `gpt-4o` is OpenAI's price, and it
        # must not be offered for a model typed under another connection.
        if name == model and entry.get("litellm_provider") != route:
            continue
        price_in = entry.get("input_cost_per_token")
        price_out = entry.get("output_cost_per_token")
        if isinstance(price_in, int | float) and isinstance(price_out, int | float):
            return _per_mtok(price_in), _per_mtok(price_out)
    return None


def _per_mtok(per_token: float) -> Decimal:
    value = Decimal(str(per_token)) * _MTOK
    # `normalize` alone writes ten as `1E+1`; a price is read by a person.
    return value.quantize(Decimal(1)) if value == value.to_integral() else value.normalize()
