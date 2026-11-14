"""The draft of a recipe file under review: its shape and the rules around it (ADR-0079).

Pure functions, no I/O. Two processes rewrite the same document — the worker
appends what the model read from the file, the API saves what the reviewer
decided — and a shape described twice would drift between them.

The document (`recipe_import_drafts.payload`):

```
{
  "recipes":     [Recipe],            # in file order
  "resolutions": {key: Resolution},   # the reviewer's decisions per name
  "candidates":  {key: [product_id]}, # catalogue suggestions per name
  "notes":       [str],               # parts of the file that were not read
  "read_at":     ISO time the reader last moved, or was last started
}
Recipe = {
  "id", "title", "category" | None, "servings", "yield_g" | None,
  "instructions", "state": "open" | "imported" | "skipped", "recipe_id" | None,
  "lines": [Line],
}
Line = {
  "line":  number of the source line (1-based) the ingredient was read from,
  "name":  the ingredient as written, "hint": Russian name for the search | None,
  "grams": float | None, "grounded": bool, "confirmed": bool, "left_out": bool,
}
Resolution = {"product_id": str} | {"left_out": True}
```

**The model does no arithmetic.** It returns the quantity and the unit as they
stand in the file; grams are derived here, and only for units of mass. A spoon,
a cup, "to taste" give no grams: the reviewer types the mass or leaves the line
out of the calculation. A mass is `grounded` only when its source line holds
exactly that quantity with that unit and names the ingredient in the same
words; anything else is kept but waits for the reviewer's confirmation.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from .repositories.product_aliases import alias_key

OPEN = "open"
IMPORTED = "imported"
SKIPPED = "skipped"

#: Grams in one unit of mass. Exact by definition (international avoirdupois).
_GRAMS_PER_UNIT: dict[str, float] = {
    "g": 1.0,
    "kg": 1000.0,
    "mg": 0.001,
    "oz": 28.349523125,
    "lb": 453.59237,
}

#: The column holds one decimal place (`recipe_ingredients.grams numeric(7,1)`).
_GRAMS_DIGITS = 1

#: The same ceiling as a hand-typed ingredient (`RecipeIngredientIn.grams`).
GRAMS_MAX = 5000.0


def new_payload() -> dict[str, Any]:
    payload: dict[str, Any] = {"recipes": [], "resolutions": {}, "candidates": {}, "notes": []}
    mark_read(payload)
    return payload


def mark_read(payload: dict[str, Any]) -> None:
    """Note that the reader has just moved (or has just been started).

    Kept apart from the row's `updated_at`: that one also moves with every save
    of the reviewer, and a reader that died would never look stalled while she
    is working in the table.
    """

    payload["read_at"] = datetime.now(UTC).isoformat()


def read_at(payload: dict[str, Any]) -> datetime | None:
    raw = payload.get("read_at")
    return datetime.fromisoformat(raw) if isinstance(raw, str) else None


def to_grams(quantity: float | None, unit: str | None) -> float | None:
    """Mass in grams, or `None` when the unit is not a unit of mass.

    Volume is not converted on purpose: a millilitre of oil and a millilitre of
    cream weigh differently, and a guessed density would be a made-up gram in a
    diet that is counted in grams.
    """

    if quantity is None or unit is None:
        return None
    factor = _GRAMS_PER_UNIT.get(unit.strip().lower())
    if factor is None:
        return None
    grams = round(quantity * factor, _GRAMS_DIGITS)
    if grams <= 0 or grams > GRAMS_MAX:
        return None
    return grams


#: A number as people write it: "1 500", "8,5", "0.5".
_QUANTITY = r"\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?"

#: How units of mass are written in the files we have seen, by our unit.
_UNIT_SPELLINGS: dict[str, str] = {
    "g": r"г|гр|грамм\w*|g|gr|gram\w*",
    "kg": r"кг|килограмм\w*|kg",
    "mg": r"мг|миллиграмм\w*|mg",
    "oz": r"oz|унц\w*|ounce\w*",
    "lb": r"lb|lbs|фунт\w*|pound\w*",
}

_MASS = re.compile(
    rf"(?<![\d.,])({_QUANTITY})\s*(?:"
    + "|".join(f"(?P<{unit}>{spelling})" for unit, spelling in _UNIT_SPELLINGS.items())
    + r")\.?(?![\w%])",
    re.IGNORECASE,
)

#: "10–15 г": the second number of a range is not a quantity of its own.
_RANGE_BEFORE = re.compile(r"\d\s*[-–—]\s*$")


def masses_in(text: str) -> list[tuple[float, str]]:
    """Quantities of mass written in a line: the number together with its unit.

    A number alone proves nothing — in "Сливки 33% — 50 г" both 33 and 50 are
    written, and only one of them is a mass. A range ("10–15 г") is not one
    quantity and is left out.
    """

    found: list[tuple[float, str]] = []
    for match in _MASS.finditer(text):
        if _RANGE_BEFORE.search(text[: match.start()]):
            continue
        unit = next(name for name, value in match.groupdict().items() if value)
        digits = re.sub(r"[ \u00a0\u202f]", "", match.group(1)).replace(",", ".")
        found.append((float(digits), unit))
    return found


def is_grounded(quantity: float, unit: str, source: str) -> bool:
    """Whether the line of the file says exactly this mass and no other.

    The line must hold one quantity of mass, with this number and this unit.
    Two masses in a line (two ingredients, or a table row of several weights)
    cannot be told apart here, and the reviewer confirms such a line herself.
    """

    masses = masses_in(source)
    if len(masses) != 1:
        return False
    written, written_unit = masses[0]
    return written_unit == unit.strip().lower() and abs(written - quantity) < 1e-9


def name_in(name: str, source: str) -> bool:
    """Whether the ingredient is named in the line with these very words."""

    folded = " ".join(source.casefold().split())
    return bool(name.strip()) and " ".join(name.casefold().split()) in folded


def source_line(source_lines: list[str], number: int | None) -> str:
    """Text of a 1-based source line; empty when the model named a line that is not there."""

    if number is None or number < 1 or number > len(source_lines):
        return ""
    return source_lines[number - 1]


def build_line(
    *,
    source_lines: list[str],
    line: int | None,
    name: str,
    hint: str | None,
    quantity: float | None,
    unit: str | None,
) -> dict[str, Any]:
    grams = to_grams(quantity, unit)
    source = source_line(source_lines, line)
    # Both halves are read by the model, so both are checked against the file:
    # the mass, and the name the product is then looked up by.
    grounded = (
        grams is not None
        and quantity is not None
        and unit is not None
        and is_grounded(quantity, unit, source)
        and name_in(name, source)
    )
    return {
        "line": line,
        "name": name.strip()[:255],
        "hint": (hint or "").strip()[:255] or None,
        "grams": grams,
        "grounded": grounded,
        "confirmed": False,
        "left_out": False,
    }


def build_recipe(
    *,
    title: str,
    category: str | None,
    servings: int | None,
    instructions: str,
    lines: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:12],
        "title": title.strip()[:255],
        "category": category,
        "servings": servings if servings is not None and 1 <= servings <= 100 else 1,
        "yield_g": None,
        "instructions": instructions.strip(),
        "state": OPEN,
        "recipe_id": None,
        "lines": lines,
    }


def instructions_from(source_lines: list[str], start: int | None, end: int | None) -> str:
    """Instructions copied from the file by line range, not retyped by the model.

    Copying keeps the text exactly as the dietitian wrote it — the model cannot
    add a step or change "175 °C" to "157 °C" in something it never emits.
    """

    if start is None or end is None or start < 1 or end < start:
        return ""
    picked = [line for line in source_lines[start - 1 : end] if line.strip()]
    return "\n".join(picked)


def quoted_from(source_lines: list[str], start: int, end: int, text: str | None) -> str:
    """Instructions the model returned as text — kept only if the file says so.

    Used where instructions share a line with other data and cannot be taken by
    range. The text must stand in the given lines word for word; otherwise it
    is the model's own writing and is dropped.
    """

    wanted = " ".join((text or "").split())
    if not wanted:
        return ""
    haystack = " ".join(" ".join(source_lines[start:end]).split())
    return (text or "").strip() if wanted in haystack else ""


def name_keys(payload: dict[str, Any]) -> list[str]:
    """Distinct ingredient names of the open recipes, in order of first appearance."""

    seen: dict[str, None] = {}
    for recipe in payload.get("recipes", []):
        if recipe.get("state") != OPEN:
            continue
        for line in recipe.get("lines", []):
            seen.setdefault(alias_key(line["name"]), None)
    return [key for key in seen if key]


def find_recipe(payload: dict[str, Any], recipe_id: str) -> dict[str, Any] | None:
    for recipe in payload.get("recipes", []):
        if recipe.get("id") == recipe_id:
            return recipe  # type: ignore[no-any-return]
    return None


def chunk_end(source_lines: list[str], start: int, *, max_lines: int, max_chars: int) -> int:
    """Index after the last line of the chunk that begins at `start` (0-based).

    A chunk is bounded both ways: by lines, so the answer fits the model's
    output limit, and by characters, so a file of long table rows does not
    become one enormous request. At least one line is always taken — otherwise
    a single over-long line would stop the parser for good.
    """

    end = start
    chars = 0
    while end < len(source_lines) and end - start < max_lines:
        chars += len(source_lines[end]) + 1
        if chars > max_chars and end > start:
            break
        end += 1
    return max(end, min(start + 1, len(source_lines)))
