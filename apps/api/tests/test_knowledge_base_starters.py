"""Ready questions on the assistant's empty screen find current articles.

Consumers: the starter buttons in the Mini App
(`apps/miniapp/src/locales/ru/app.json`, `assistant.starters.*.ask`) and in the
family cabinet (`apps/web/src/locales/ru/assistant.json`, `starters`). The app
suggests these questions itself (Mini App audit 2026-11, decision Р5), so a
starter that finds nothing, or finds an article pointing to a screen the Mini
App no longer has, is the app giving its own bad first answer. Three of the
six once sent families to the «Сводка» and «Меню» tabs, gone since ADR-0075.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from core.knowledge.indexer import reindex
from core.repositories import knowledge_base as kb

REPO = Path(__file__).resolve().parents[3]
KB_ROOT = REPO / "docs" / "knowledge-base"

#: Passages the assistant hands to the model (`worker.ai.assistant.MAX_PASSAGES`).
MAX_PASSAGES = 5

#: Which article each starter is about.
EXPECTED = {
    "seizure": "how-to-record-seizure",
    "menu": "how-to-plan-the-day",
    "fixEntry": "how-to-fix-an-entry",
    "invite": "how-to-invite-family",
    "reminders": "how-to-set-reminders",
    "dishMismatch": "why-dish-does-not-add-up",
}

#: Mini App places that no longer exist (ADR-0075: four tabs, settings apart).
STALE_PLACES = re.compile(
    r"вкладк\w*\s+«(?:Сводка|Меню|Рецепты|Расчёт|Динамика)»|на главной",
    re.IGNORECASE,
)


def _starters() -> dict[str, set[str]]:
    miniapp = json.loads(
        (REPO / "apps/miniapp/src/locales/ru/app.json").read_text(encoding="utf-8")
    )["assistant"]["starters"]
    cabinet = json.loads(
        (REPO / "apps/web/src/locales/ru/assistant.json").read_text(encoding="utf-8")
    )["starters"]
    return {key: {miniapp[key]["ask"], cabinet[key]} for key in EXPECTED}


def test_every_starter_has_an_expected_article() -> None:
    """A new starter without a line here would go unchecked."""

    miniapp = json.loads(
        (REPO / "apps/miniapp/src/locales/ru/app.json").read_text(encoding="utf-8")
    )["assistant"]["starters"]
    cabinet = json.loads(
        (REPO / "apps/web/src/locales/ru/assistant.json").read_text(encoding="utf-8")
    )["starters"]
    assert set(miniapp) == set(EXPECTED) == set(cabinet)


@pytest.mark.parametrize("name", sorted(p.name for p in (KB_ROOT / "product").glob("*.md")))
def test_product_articles_name_only_existing_mini_app_places(name: str) -> None:
    text = (KB_ROOT / "product" / name).read_text(encoding="utf-8")
    assert not STALE_PLACES.findall(text), name


@pytest.mark.asyncio
async def test_starters_retrieve_their_articles(session) -> None:
    """Indexed the way `make kb-index` indexes it, each starter finds its article
    among the passages the assistant hands to the model."""

    await reindex(session, root=KB_ROOT)

    for key, questions in _starters().items():
        for question in questions:
            found = await kb.search(session, q=question, limit=MAX_PASSAGES)
            slugs = [passage.doc_slug for passage in found]
            assert EXPECTED[key] in slugs, (question, slugs)
