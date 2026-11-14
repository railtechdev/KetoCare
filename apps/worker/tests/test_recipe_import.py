"""Reading a recipe file: the model points at lines, the server derives the rest (ADR-0079)."""

from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker

from core import recipe_import as shape
from core.models import Product, ProductCategory
from core.models.enums import AiJobKind
from core.repositories import recipe_import_drafts as drafts_repo
from worker.ai import recipe_import as reader

from .test_ai_client import FakeMessages, answer, client_for, jobs_of

LINES = [
    "# Кето-блинчики",
    "Ингредиенты:",
    "Орехи макадамия (обжаренные) — 30 г",
    "Яйцо — 28 г",
    "Ванильный экстракт — 3 капли (по желанию)",
    "Соль по вкусу",
    "Приготовление:",
    "Измельчить орехи.",
    "Обжарить с двух сторон.",
]

ANSWER: dict[str, Any] = {
    "recipes": [
        {
            "title": "Кето-блинчики",
            "category": "breakfast",
            "servings": None,
            "ingredients": [
                {"line": 3, "name": "Орехи макадамия (обжаренные)", "quantity": 30, "unit": "g"},
                {"line": 4, "name": "Яйцо", "quantity": 28, "unit": "g"},
                {"line": 5, "name": "Ванильный экстракт", "quantity": 3, "unit": "other"},
                {"line": 6, "name": "Соль", "quantity": None, "unit": None},
            ],
            "instructions_from": 8,
            "instructions_to": 9,
            "instructions": None,
        }
    ],
    "resume_from_line": None,
}


def _read(data: dict[str, Any], *, start: int = 0, end: int | None = None) -> list[dict[str, Any]]:
    return reader.to_draft_recipes(
        reader.ReadAnswer.model_validate(data),
        source_lines=LINES,
        start=start,
        end=len(LINES) if end is None else end,
    )


class TestAnswerBecomesDraft:
    def test_grams_come_from_the_unit_not_from_the_model(self):
        (recipe,) = _read(ANSWER)

        assert [line["grams"] for line in recipe["lines"]] == [30.0, 28.0, None, None]

    def test_instructions_are_copied_from_the_file(self):
        (recipe,) = _read(ANSWER)

        assert recipe["instructions"] == "Измельчить орехи.\nОбжарить с двух сторон."

    def test_a_quantity_missing_from_its_line_is_marked(self):
        """«28» read as «82»: the mass stays, the reviewer must confirm it."""

        data = json.loads(json.dumps(ANSWER))
        data["recipes"][0]["ingredients"][1]["quantity"] = 82

        (recipe,) = _read(data)

        assert recipe["lines"][1]["grams"] == 82.0
        assert recipe["lines"][1]["grounded"] is False
        assert recipe["lines"][0]["grounded"] is True

    def test_a_line_outside_the_given_part_is_not_trusted(self):
        data = json.loads(json.dumps(ANSWER))
        data["recipes"][0]["ingredients"][0]["line"] = 400

        (recipe,) = _read(data)

        assert recipe["lines"][0]["line"] is None
        assert recipe["lines"][0]["grounded"] is False

    def test_an_unknown_category_is_dropped(self):
        data = json.loads(json.dumps(ANSWER))
        data["recipes"][0]["category"] = "main course"

        (recipe,) = _read(data)

        assert recipe["category"] is None

    def test_an_invalid_answer_names_the_problem(self):
        try:
            reader._validated('{"recipes": [{"ingredients": []}]}')
        except ValueError as error:
            assert "title" in str(error)
        else:  # pragma: no cover - the assertion above must run
            raise AssertionError("an answer without a title must not validate")


class TestNextPart:
    def _answer(self, resume: int | None) -> reader.ReadAnswer:
        return reader.ReadAnswer(recipes=[], resume_from_line=resume)

    def test_without_a_cut_recipe_the_next_part_follows(self):
        assert reader.next_position(self._answer(None), start=0, end=90, total=300) == (90, False)

    def test_a_cut_recipe_is_read_again_from_its_first_line(self):
        assert reader.next_position(self._answer(81), start=0, end=90, total=300) == (80, False)

    def test_a_recipe_longer_than_a_part_is_skipped_and_reported(self):
        """Asking for it again would never end."""

        assert reader.next_position(self._answer(1), start=0, end=90, total=300) == (90, True)

    def test_the_last_part_has_nothing_to_resume(self):
        assert reader.next_position(self._answer(81), start=0, end=90, total=90) == (90, False)


async def _draft(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID, lines: list[str]
) -> uuid.UUID:
    async with sessionmaker() as session:
        draft = await drafts_repo.create(
            session,
            created_by=user_id,
            file_name="recipes.docx",
            source_lines=lines,
            payload=shape.new_payload(),
        )
        await session.commit()
        return draft.id


async def _product(sessionmaker: async_sessionmaker, name: str) -> uuid.UUID:
    async with sessionmaker() as session:
        category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:6]}", sort=0)
        session.add(category)
        await session.flush()
        product = Product(
            name_ru=name,
            category_id=category.id,
            kcal_100g=718,
            fat_100g=75.8,
            protein_100g=7.9,
            carbs_100g=13.8,
            fiber_100g=8.6,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )
        session.add(product)
        await session.commit()
        return product.id


class TestAdvance:
    async def test_a_small_file_is_read_in_one_part(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        draft_id = await _draft(sessionmaker, user_id, LINES)
        client = client_for(sessionmaker, FakeMessages(answer(json.dumps(ANSWER))))

        more = await reader.advance(sessionmaker, client, draft_id)

        assert more is False
        async with sessionmaker() as session:
            draft = await drafts_repo.get(session, draft_id)
        assert draft is not None
        assert draft.status == drafts_repo.READY
        assert draft.lines_done == len(LINES)
        assert [recipe["title"] for recipe in draft.payload["recipes"]] == ["Кето-блинчики"]

    async def test_the_call_is_journalled_under_its_own_kind(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """The cost of reading files must be visible apart from everything else."""

        draft_id = await _draft(sessionmaker, user_id, LINES)
        client = client_for(sessionmaker, FakeMessages(answer(json.dumps(ANSWER))))

        await reader.advance(sessionmaker, client, draft_id)

        (job,) = await jobs_of(sessionmaker)
        assert job.kind is AiJobKind.RECIPE_IMPORT
        assert job.patient_id is None

    async def test_the_catalogue_is_searched_for_suggestions(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Found by search is a suggestion: stored as a candidate, matched by nobody."""

        product_id = await _product(sessionmaker, "Макадамия")
        draft_id = await _draft(sessionmaker, user_id, LINES)
        client = client_for(sessionmaker, FakeMessages(answer(json.dumps(ANSWER))))

        await reader.advance(sessionmaker, client, draft_id)

        async with sessionmaker() as session:
            draft = await drafts_repo.get(session, draft_id)
        assert draft is not None
        assert draft.payload["candidates"]["орехи макадамия (обжаренные)"] == [str(product_id)]
        assert draft.payload["resolutions"] == {}

    async def test_an_answer_that_is_not_json_twice_is_noted_not_fatal(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """One unreadable part must not lose the rest of the file."""

        draft_id = await _draft(sessionmaker, user_id, LINES)
        messages = FakeMessages(answer("вот ваши рецепты"))
        client = client_for(sessionmaker, messages)

        await reader.advance(sessionmaker, client, draft_id)

        assert len(messages.calls) == 2
        async with sessionmaker() as session:
            draft = await drafts_repo.get(session, draft_id)
        assert draft is not None
        assert draft.status == drafts_repo.READY
        assert draft.payload["notes"] == [f"Строки 1–{len(LINES)} прочитать не удалось."]

    async def test_a_long_file_asks_for_another_run(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        lines = LINES * 20
        draft_id = await _draft(sessionmaker, user_id, lines)
        empty = json.dumps({"recipes": [], "resume_from_line": None})
        client = client_for(sessionmaker, FakeMessages(answer(empty)))

        more = await reader.advance(sessionmaker, client, draft_id)

        assert more is True
        async with sessionmaker() as session:
            draft = await drafts_repo.get(session, draft_id)
        assert draft is not None
        assert draft.status == drafts_repo.PARSING
        assert draft.lines_done == reader.CHUNK_LINES

    async def test_a_refusal_keeps_what_was_read_and_says_why(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """The reviewer continues later from the same line, not from the start."""

        draft_id = await _draft(sessionmaker, user_id, LINES)
        client = client_for(
            sessionmaker, FakeMessages(answer(json.dumps(ANSWER))), ai_daily_budget_usd=0.0
        )

        more = await reader.advance(sessionmaker, client, draft_id)

        assert more is False
        async with sessionmaker() as session:
            draft = await drafts_repo.get(session, draft_id)
        assert draft is not None
        assert draft.status == drafts_repo.FAILED
        assert draft.failure
        assert draft.lines_done == 0

    async def test_a_second_run_of_the_same_part_writes_nothing(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """«Continue» pressed twice must not double the recipes."""

        draft_id = await _draft(sessionmaker, user_id, LINES)
        client = client_for(sessionmaker, FakeMessages(answer(json.dumps(ANSWER))))

        await reader.advance(sessionmaker, client, draft_id)
        await reader.advance(sessionmaker, client, draft_id)

        async with sessionmaker() as session:
            draft = await drafts_repo.get(session, draft_id)
        assert draft is not None
        assert len(draft.payload["recipes"]) == 1
