"""`/recipe-imports` — a recipe file through a review table (ADR-0079).

The file is read by the worker; here the draft is put in place as the worker
would leave it, and the tests are about what the reviewer sees and may do.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pytest
from sqlalchemy import select

from core import recipe_import as shape
from core.models import Product, ProductAlias, ProductCategory, Recipe
from core.models.enums import RecipeStatus, UserRole
from core.repositories import recipe_import_drafts as drafts_repo

pytestmark = pytest.mark.asyncio

LINES = [
    "# Кето-блинчики",
    "Орехи макадамия (обжаренные) — 30 г",
    "Яйцо — 28 г",
    "Ванильный экстракт — 3 капли (по желанию)",
    "Соль по вкусу",
    "Смешать и обжарить.",
]


async def _product(session, name: str, *, counts: bool = True, **values: Any) -> Product:
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:6]}", sort=0)
    session.add(category)
    await session.flush()
    fields: dict[str, Any] = {
        "kcal_100g": 718,
        "fat_100g": 75.8,
        "protein_100g": 7.9,
        "carbs_100g": 13.8,
        "fiber_100g": 8.6,
    }
    fields.update(values)
    product = Product(
        name_ru=name,
        category_id=category.id,
        source="USDA",
        source_version="SR28",
        verified_at=date(2026, 1, 1),
        counts_in_calculation=counts,
        **fields,
    )
    session.add(product)
    await session.flush()
    return product


def _line(number: int, name: str, quantity: float | None, unit: str | None) -> dict[str, Any]:
    return shape.build_line(
        source_lines=LINES, line=number, name=name, hint=None, quantity=quantity, unit=unit
    )


async def _draft(session, user, *, recipes: list[dict[str, Any]] | None = None):
    payload = shape.new_payload()
    payload["recipes"] = recipes or [
        shape.build_recipe(
            title="Кето-блинчики",
            category="breakfast",
            servings=None,
            instructions="Смешать и обжарить.",
            lines=[
                _line(2, "Орехи макадамия (обжаренные)", 30, "g"),
                _line(3, "Яйцо", 28, "g"),
                _line(4, "Ванильный экстракт", 3, "other"),
                _line(5, "Соль", None, None),
            ],
        )
    ]
    draft = await drafts_repo.create(
        session,
        created_by=user.id,
        file_name="recipes.docx",
        source_lines=LINES,
        payload=payload,
    )
    draft.status = drafts_repo.READY
    draft.lines_done = len(LINES)
    await session.flush()
    return draft


async def _accept(client, url: str, headers, *, signature: str | None = None):
    """Accept every row the screen shows as ready — as the screen does it."""

    view = (await client.get(url, headers=headers)).json()
    rows = [
        {"id": item["id"], "signature": signature or item["signature"]}
        for item in view["items"]
        if item["state"] == "ready" or signature is not None
    ]
    return await client.post(f"{url}/commit", json={"recipes": rows}, headers=headers)


def _name(view: dict[str, Any], name: str) -> dict[str, Any]:
    return next(item for item in view["names"] if item["name"] == name)


class TestUpload:
    async def test_pasted_text_starts_a_draft_and_queues_the_reader(
        self, client, make_user, auth_headers, enqueued
    ):
        dietitian = await make_user(UserRole.DIETITIAN)

        response = await client.post(
            "/api/v1/recipe-imports",
            data={"text": "Омлет\nЯйцо — 55 г\nМасло сливочное — 30 г"},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 202, response.text
        body = response.json()
        assert body["status"] == "parsing"
        assert body["lines_total"] == 3
        assert enqueued == [("parse_recipe_file", (body["id"],))]

    async def test_an_unreadable_file_is_refused_with_a_way_out(
        self, client, make_user, auth_headers, enqueued
    ):
        dietitian = await make_user(UserRole.DIETITIAN)

        response = await client.post(
            "/api/v1/recipe-imports",
            files={"file": ("recipes.pdf", b"%PDF-1.7 ...", "application/pdf")},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422
        assert "Вставить текст" in response.json()["error"]["message"]
        assert enqueued == []

    async def test_nothing_to_read_is_a_validation_error(self, client, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)

        response = await client.post("/api/v1/recipe-imports", headers=auth_headers(dietitian))

        assert response.status_code == 422

    async def test_a_family_cannot_upload(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/recipe-imports", data={"text": "Омлет"}, headers=auth_headers(parent)
        )

        assert response.status_code == 403


class TestView:
    async def test_names_wait_for_the_reviewer_until_matched(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)

        response = await client.get(
            f"/api/v1/recipe-imports/{draft.id}", headers=auth_headers(dietitian)
        )

        assert response.status_code == 200, response.text
        view = response.json()
        assert {item["state"] for item in view["names"]} == {"unresolved"}
        (recipe,) = view["items"]
        assert recipe["state"] == "needs_work"
        assert recipe["problems"] == ["lines"]
        # Numbers are not shown for a part of a dish.
        assert recipe["kcal"] is None
        assert recipe["lines"][0]["source"] == "Орехи макадамия (обжаренные) — 30 г"
        assert view["ready"] == 0

    async def test_the_same_name_in_the_catalogue_matches_by_itself(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        await _product(session, "яйцо")
        draft = await _draft(session, dietitian)

        view = (
            await client.get(f"/api/v1/recipe-imports/{draft.id}", headers=auth_headers(dietitian))
        ).json()

        egg = _name(view, "Яйцо")
        assert egg["state"] == "matched"
        assert egg["source"] == "exact"

    async def test_a_search_hit_is_only_a_suggestion(
        self, client, session, make_user, auth_headers
    ):
        """«Сливки 10 %» for «сливки 33 %» is a different ketogenic ratio."""

        dietitian = await make_user(UserRole.DIETITIAN)
        nut = await _product(session, "Макадамия")
        draft = await _draft(session, dietitian)
        draft.payload["candidates"]["орехи макадамия (обжаренные)"] = [str(nut.id)]
        drafts_repo.touch_payload(draft)
        await session.flush()

        view = (
            await client.get(f"/api/v1/recipe-imports/{draft.id}", headers=auth_headers(dietitian))
        ).json()

        name = _name(view, "Орехи макадамия (обжаренные)")
        assert name["state"] == "unresolved"
        assert [item["name_ru"] for item in name["candidates"]] == ["Макадамия"]

    async def test_somebody_elses_draft_is_not_found(
        self, client, session, make_user, auth_headers
    ):
        author = await make_user(UserRole.DIETITIAN)
        other = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, author)

        response = await client.get(
            f"/api/v1/recipe-imports/{draft.id}", headers=auth_headers(other)
        )

        assert response.status_code == 404

    async def test_the_list_holds_only_open_drafts_of_the_reviewer(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        other = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)
        await _draft(session, other)

        listed = (
            await client.get("/api/v1/recipe-imports", headers=auth_headers(dietitian))
        ).json()
        assert [item["id"] for item in listed] == [str(draft.id)]

        closed = await client.delete(
            f"/api/v1/recipe-imports/{draft.id}", headers=auth_headers(dietitian)
        )
        assert closed.status_code == 204
        listed = (
            await client.get("/api/v1/recipe-imports", headers=auth_headers(dietitian))
        ).json()
        assert listed == []


class TestDecisions:
    async def _settle(self, client, session, dietitian, headers):
        """Match everything the dish needs, as the reviewer would."""

        nut = await _product(session, "Макадамия")
        await _product(session, "Яйцо")
        await _product(session, "Соль", counts=False)
        draft = await _draft(session, dietitian)
        url = f"/api/v1/recipe-imports/{draft.id}"

        response = await client.put(
            f"{url}/names",
            json={"key": "Орехи макадамия (обжаренные)", "product_id": str(nut.id)},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        response = await client.put(
            f"{url}/names", json={"key": "Ванильный экстракт", "left_out": True}, headers=headers
        )
        assert response.status_code == 200, response.text
        return draft, url, response.json()

    async def test_a_recipe_becomes_ready_and_is_counted(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        _, _, view = await self._settle(client, session, dietitian, auth_headers(dietitian))

        (recipe,) = view["items"]
        assert recipe["state"] == "ready", recipe["problems"]
        assert recipe["kcal"] > 0
        assert recipe["ratio"] is not None
        states = {line["name"]: line["state"] for line in recipe["lines"]}
        assert states == {
            "Орехи макадамия (обжаренные)": "ok",
            "Яйцо": "ok",
            "Ванильный экстракт": "left_out",
            # A seasoning needs no mass (ADR-0054).
            "Соль": "left_out",
        }
        assert view["ready"] == 1

    async def test_a_choice_is_remembered_for_the_next_file(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        await self._settle(client, session, dietitian, auth_headers(dietitian))

        alias = await session.scalar(
            select(ProductAlias).where(ProductAlias.alias == "орехи макадамия (обжаренные)")
        )
        assert alias is not None

        # A new file with the same spelling, read by another specialist.
        other = await make_user(UserRole.DOCTOR)
        second = await _draft(session, other)
        view = (
            await client.get(f"/api/v1/recipe-imports/{second.id}", headers=auth_headers(other))
        ).json()

        name = _name(view, "Орехи макадамия (обжаренные)")
        assert name["state"] == "matched"
        assert name["source"] == "alias"

    async def test_a_remembered_match_is_audited(self, client, session, make_user, auth_headers):
        """It decides which product later recipes get without a question."""

        from core.models import AuditLog

        dietitian = await make_user(UserRole.DIETITIAN)
        await self._settle(client, session, dietitian, auth_headers(dietitian))

        entry = await session.scalar(select(AuditLog).where(AuditLog.action == "alias"))
        assert entry is not None
        assert entry.entity == "products"
        assert entry.after["alias"] == "орехи макадамия (обжаренные)"

    async def test_a_wrong_click_can_be_withdrawn(self, client, session, make_user, auth_headers):
        """Otherwise the name would match again through the alias it just made."""

        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        _, url, _ = await self._settle(client, session, dietitian, headers)

        response = await client.put(
            f"{url}/names", json={"key": "Орехи макадамия (обжаренные)"}, headers=headers
        )

        assert _name(response.json(), "Орехи макадамия (обжаренные)")["state"] == "unresolved"
        alias = await session.scalar(
            select(ProductAlias).where(ProductAlias.alias == "орехи макадамия (обжаренные)")
        )
        assert alias is None

    async def test_somebody_elses_match_is_not_withdrawn_with_mine(
        self, client, session, make_user, auth_headers
    ):
        """Leaving a name out in my file must not undo a colleague's match for all."""

        author = await make_user(UserRole.DIETITIAN)
        await self._settle(client, session, author, auth_headers(author))
        other = await make_user(UserRole.DOCTOR)
        second = await _draft(session, other)

        response = await client.put(
            f"/api/v1/recipe-imports/{second.id}/names",
            json={"key": "Орехи макадамия (обжаренные)", "left_out": True},
            headers=auth_headers(other),
        )

        assert response.status_code == 200, response.text
        alias = await session.scalar(
            select(ProductAlias).where(ProductAlias.alias == "орехи макадамия (обжаренные)")
        )
        assert alias is not None

    async def test_a_mass_that_rounds_to_nothing_is_refused(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)

        response = await client.patch(
            f"/api/v1/recipe-imports/{draft.id}/recipes/{draft.payload['recipes'][0]['id']}",
            json={"lines": [{"index": 0, "grams": 0.04}]},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422

    async def test_an_archived_product_cannot_be_chosen(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        retired = await _product(session, "Макадамия старая")
        retired.is_active = False
        draft = await _draft(session, dietitian)

        response = await client.put(
            f"/api/v1/recipe-imports/{draft.id}/names",
            json={"key": "Яйцо", "product_id": str(retired.id)},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422

    async def test_a_mass_typed_by_the_reviewer_settles_the_line(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        await _product(session, "Ванильный экстракт")
        draft = await _draft(session, dietitian)
        url = f"/api/v1/recipe-imports/{draft.id}"
        recipe_id = draft.payload["recipes"][0]["id"]

        before = (await client.get(url, headers=auth_headers(dietitian))).json()
        assert before["items"][0]["lines"][2]["state"] == "no_grams"

        response = await client.patch(
            f"{url}/recipes/{recipe_id}",
            json={"lines": [{"index": 2, "grams": 0.2}]},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        line = response.json()["items"][0]["lines"][2]
        assert line["state"] == "ok"
        assert line["grams"] == 0.2

    async def test_a_mass_not_found_in_its_line_waits_for_confirmation(
        self, client, session, make_user, auth_headers
    ):
        """«28» read as «82» must not go through «accept all»."""

        dietitian = await make_user(UserRole.DIETITIAN)
        await _product(session, "Яйцо")
        recipe = shape.build_recipe(
            title="Яичница",
            category="breakfast",
            servings=None,
            instructions="",
            lines=[_line(3, "Яйцо", 82, "g")],
        )
        draft = await _draft(session, dietitian, recipes=[recipe])
        url = f"/api/v1/recipe-imports/{draft.id}"

        view = (await client.get(url, headers=auth_headers(dietitian))).json()
        assert view["items"][0]["lines"][0]["state"] == "unconfirmed"
        assert view["ready"] == 0

        response = await client.patch(
            f"{url}/recipes/{recipe['id']}",
            json={"lines": [{"index": 0, "confirmed": True}]},
            headers=auth_headers(dietitian),
        )
        assert response.json()["items"][0]["state"] == "ready"


class TestCommit:
    async def test_ready_recipes_become_library_drafts(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        _, url, _ = await TestDecisions()._settle(client, session, dietitian, headers)

        response = await _accept(client, url, headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["imported"] == 1
        assert body["draft"]["items"][0]["state"] == "imported"

        recipe = await session.scalar(select(Recipe).where(Recipe.title == "Кето-блинчики"))
        assert recipe is not None
        assert recipe.status is RecipeStatus.DRAFT
        assert recipe.computed is not None
        assert recipe.engine_version
        assert recipe.source_ref == "recipes.docx"
        assert float(recipe.yield_g) == 58.0
        # What is not weighed stays in the text: the family must still see it.
        assert recipe.instructions.startswith(
            "Без взвешивания: Ванильный экстракт — 3 капли (по желанию); Соль по вкусу."
        )
        assert recipe.instructions.endswith("Смешать и обжарить.")

    async def test_a_second_commit_creates_nothing(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        _, url, _ = await TestDecisions()._settle(client, session, dietitian, headers)

        view = (await client.get(url, headers=headers)).json()
        rows = [{"id": item["id"], "signature": item["signature"]} for item in view["items"]]

        first = await client.post(f"{url}/commit", json={"recipes": rows}, headers=headers)
        again = await client.post(f"{url}/commit", json={"recipes": rows}, headers=headers)

        assert first.json()["imported"] == 1
        assert again.json()["imported"] == 0

    async def test_rows_that_are_not_ready_stay(self, client, session, make_user, auth_headers):
        """Import what is done, come back to the rest."""

        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)

        response = await _accept(
            client,
            f"/api/v1/recipe-imports/{draft.id}",
            auth_headers(dietitian),
            signature="whatever-the-client-says",
        )

        assert response.json()["imported"] == 0
        assert response.json()["draft"]["items"][0]["state"] == "needs_work"

    async def test_a_row_that_changed_since_it_was_shown_is_not_written(
        self, client, session, make_user, auth_headers
    ):
        """What she accepted is what her screen showed, not what is there by now."""

        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        draft, url, shown = await TestDecisions()._settle(client, session, dietitian, headers)
        row = shown["items"][0]

        # Somebody re-points the shared alias after the screen was drawn.
        other_nut = await _product(session, "Макадамия в шоколаде", carbs_100g=40.0)
        changed = await client.put(
            f"{url}/names",
            json={"key": "Орехи макадамия (обжаренные)", "product_id": str(other_nut.id)},
            headers=headers,
        )
        assert changed.json()["items"][0]["signature"] != row["signature"]

        response = await client.post(
            f"{url}/commit",
            json={"recipes": [{"id": row["id"], "signature": row["signature"]}]},
            headers=headers,
        )

        assert response.json()["imported"] == 0
        assert response.json()["draft"]["items"][0]["state"] == "ready"

    async def test_accepting_nothing_is_a_validation_error(
        self, client, session, make_user, auth_headers
    ):
        """There is no «everything that is ready»: it would include unseen rows."""

        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)

        response = await client.post(
            f"/api/v1/recipe-imports/{draft.id}/commit",
            json={"recipes": []},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422

    async def test_an_existing_recipe_is_not_overwritten(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        session.add(
            Recipe(
                title="кето-блинчики",
                category="breakfast",
                yield_g=100,
                servings=1,
                instructions="",
                author_id=dietitian.id,
                status=RecipeStatus.PUBLISHED,
            )
        )
        await session.flush()
        draft, url, view = await TestDecisions()._settle(client, session, dietitian, headers)

        assert view["items"][0]["problems"] == ["title_taken"]

        renamed = await client.patch(
            f"{url}/recipes/{draft.payload['recipes'][0]['id']}",
            json={"title": "Кето-блинчики с макадамией"},
            headers=headers,
        )
        assert renamed.json()["items"][0]["state"] == "ready"

    async def test_a_skipped_recipe_is_not_imported(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        draft, url, _ = await TestDecisions()._settle(client, session, dietitian, headers)
        recipe_id = draft.payload["recipes"][0]["id"]

        skipped = await client.patch(
            f"{url}/recipes/{recipe_id}", json={"skipped": True}, headers=headers
        )
        assert skipped.json()["items"][0]["state"] == "skipped"

        response = await _accept(client, url, headers, signature="any")
        assert response.json()["imported"] == 0

    async def test_the_same_product_written_twice_is_one_ingredient(
        self, client, session, make_user, auth_headers
    ):
        """A recipe may not hold a product twice; the masses add up."""

        dietitian = await make_user(UserRole.DIETITIAN)
        headers = auth_headers(dietitian)
        await _product(session, "Яйцо")
        recipe = shape.build_recipe(
            title="Двойное яйцо",
            category="breakfast",
            servings=None,
            instructions="",
            lines=[_line(3, "Яйцо", 28, "g"), _line(3, "Яйцо", 28, "g")],
        )
        draft = await _draft(session, dietitian, recipes=[recipe])

        response = await _accept(client, f"/api/v1/recipe-imports/{draft.id}", headers)

        assert response.json()["imported"] == 1
        created = await session.scalar(select(Recipe).where(Recipe.title == "Двойное яйцо"))
        assert created is not None
        assert float(created.yield_g) == 56.0


class TestResume:
    async def test_a_stopped_reading_continues_from_where_it_stood(
        self, client, session, make_user, auth_headers, enqueued
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)
        draft.status = drafts_repo.FAILED
        draft.failure = "Дневной лимит исчерпан."
        draft.lines_done = 2
        await session.flush()

        response = await client.post(
            f"/api/v1/recipe-imports/{draft.id}/resume", headers=auth_headers(dietitian)
        )

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "parsing"
        assert response.json()["failure"] is None
        assert enqueued == [("parse_recipe_file", (str(draft.id),))]

    async def test_a_reading_in_progress_is_not_started_twice(
        self, client, session, make_user, auth_headers, enqueued
    ):
        """Every extra run is a paid model call whose answer is thrown away."""

        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)
        draft.status = drafts_repo.PARSING
        draft.lines_done = 2
        await session.flush()

        response = await client.post(
            f"/api/v1/recipe-imports/{draft.id}/resume", headers=auth_headers(dietitian)
        )

        assert response.status_code == 409
        assert enqueued == []

    async def test_a_reader_that_went_silent_may_be_restarted(
        self, client, session, make_user, auth_headers, enqueued
    ):
        """Silent by its own clock: the reviewer's saves do not reset it."""

        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)
        draft.status = drafts_repo.PARSING
        draft.lines_done = 2
        draft.payload["read_at"] = "2026-11-14T00:00:00+00:00"
        drafts_repo.touch_payload(draft)
        await session.flush()
        url = f"/api/v1/recipe-imports/{draft.id}"

        view = (await client.get(url, headers=auth_headers(dietitian))).json()
        assert view["stalled"] is True

        response = await client.post(f"{url}/resume", headers=auth_headers(dietitian))

        assert response.status_code == 200, response.text
        assert response.json()["stalled"] is False
        assert enqueued == [("parse_recipe_file", (str(draft.id),))]

    async def test_a_file_read_to_the_end_has_nothing_to_continue(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        draft = await _draft(session, dietitian)

        response = await client.post(
            f"/api/v1/recipe-imports/{draft.id}/resume", headers=auth_headers(dietitian)
        )

        assert response.status_code == 409


class TestContractWithTheCabinet:
    """The shape `apps/web` reads (`features/recipes/useRecipeImportDraft.ts`).

    The cabinet's tests run against a hand-made copy of this answer; this test
    is what keeps the copy honest.
    """

    async def test_the_view_has_the_fields_the_review_screen_reads(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        nut = await _product(session, "Макадамия")
        draft = await _draft(session, dietitian)
        draft.payload["candidates"]["орехи макадамия (обжаренные)"] = [str(nut.id)]
        drafts_repo.touch_payload(draft)
        await session.flush()

        view = (
            await client.get(f"/api/v1/recipe-imports/{draft.id}", headers=auth_headers(dietitian))
        ).json()

        assert set(view) == {
            "id",
            "file_name",
            "status",
            "created_at",
            "lines_total",
            "lines_done",
            "recipes",
            "imported",
            "failure",
            "stalled",
            "notes",
            "names",
            "items",
            "ready",
        }
        name = _name(view, "Орехи макадамия (обжаренные)")
        assert set(name) == {
            "key",
            "name",
            "hint",
            "recipes",
            "state",
            "source",
            "product",
            "candidates",
        }
        assert set(name["candidates"][0]) == {"id", "name_ru", "counts_in_calculation"}
        (recipe,) = view["items"]
        assert set(recipe) == {
            "id",
            "title",
            "category",
            "servings",
            "yield_g",
            "instructions",
            "state",
            "problems",
            "signature",
            "recipe_id",
            "kcal",
            "ratio",
            "lines",
        }
        assert set(recipe["lines"][0]) == {
            "index",
            "source",
            "name",
            "key",
            "grams",
            "state",
            "left_out",
            "product_name",
        }
