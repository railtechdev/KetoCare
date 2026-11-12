"""Сообщения воркера в Telegram — тем же словарём, что кабинет, приложение и бот.

Список запрещённых слов один на четыре канала:
`packages/ui/src/testing/forbiddenTerms.json` (docs/PLAN_UI_TEXT_2026-11.md,
раздел 3). Проверяются оба каталога `worker.reminders.texts` и названия
месяцев — всё, что уходит семье.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from worker.reminders import texts

REPO_ROOT = Path(__file__).resolve().parents[3]
TERMS_FILE = REPO_ROOT / "packages" / "ui" / "src" / "testing" / "forbiddenTerms.json"


def forbidden_terms() -> list[tuple[re.Pattern[str], str]]:
    data = json.loads(TERMS_FILE.read_text(encoding="utf-8"))
    return [
        (re.compile(term["pattern"], re.IGNORECASE if "i" in term["flags"] else 0), term["why"])
        for term in data["terms"]
    ]


def test_the_shared_list_is_found() -> None:
    assert len(forbidden_terms()) > 0


@pytest.mark.parametrize("language", sorted(texts.CATALOG))
def test_catalog_uses_no_forbidden_terms(language: str) -> None:
    terms = forbidden_terms()
    entries = [*texts.CATALOG[language].items()]
    entries += [(f"month {n}", name) for n, name in enumerate(texts.MONTHS[language], 1)]
    found = [
        f"{language}.{key}: «{match.group(0)}» — {why}"
        for key, text in entries
        for pattern, why in terms
        if (match := pattern.search(text))
    ]
    assert found == []
