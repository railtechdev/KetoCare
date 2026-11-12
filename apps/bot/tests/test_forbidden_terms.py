"""Тексты бота — тем же словарём, что кабинет и приложение.

Список запрещённых слов один на четыре канала (кабинет, приложение в Telegram,
бот, сообщения воркера): `packages/ui/src/testing/forbiddenTerms.json`,
docs/PLAN_UI_TEXT_2026-11.md, раздел 3. Проверяются строки, которые видит
семья, — константы каталогов `texts_ru` и `texts_uz` (в том числе внутри
словарей), а не комментарии и не docstring'и.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from bot import texts_ru, texts_uz

REPO_ROOT = Path(__file__).resolve().parents[3]
TERMS_FILE = REPO_ROOT / "packages" / "ui" / "src" / "testing" / "forbiddenTerms.json"


def forbidden_terms() -> list[tuple[re.Pattern[str], str]]:
    data = json.loads(TERMS_FILE.read_text(encoding="utf-8"))
    return [
        (re.compile(term["pattern"], re.IGNORECASE if "i" in term["flags"] else 0), term["why"])
        for term in data["terms"]
    ]


def strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in strings(item)]
    if isinstance(value, list | tuple):
        return [text for item in value for text in strings(item)]
    return []


def catalog(module: ModuleType) -> dict[str, list[str]]:
    """Константы каталога: имена ПРОПИСНЫМИ, значения — строки или словари строк."""

    return {
        name: strings(value)
        for name, value in vars(module).items()
        if name.isupper() and not name.startswith("__")
    }


def test_the_shared_list_is_found() -> None:
    assert len(forbidden_terms()) > 0


@pytest.mark.parametrize("module", [texts_ru, texts_uz], ids=["ru", "uz"])
def test_catalog_uses_no_forbidden_terms(module: ModuleType) -> None:
    terms = forbidden_terms()
    found = [
        f"{name}: «{match.group(0)}» — {why}"
        for name, texts in catalog(module).items()
        for text in texts
        for pattern, why in terms
        if (match := pattern.search(text))
    ]
    assert found == []
