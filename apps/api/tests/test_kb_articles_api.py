"""Knowledge base articles in the cabinet (ADR-0093).

Consumers: the cabinet's knowledge base sections — the specialists' clinical
articles (`/knowledge-base/clinical-articles`, with the navigation badge from
`/review-count`) and the administrator's product articles
(`/admin/knowledge-base/product-articles`), and the Word import of both forms
(`/knowledge-base/article-text`). Their screens test against a fake API, so the
shapes and the rules are pinned here, on the supplier side.

The rules that matter most: the administrator never reaches clinical text; a
clinical version is published only by somebody other than its author; a
published version never changes; withdrawing takes the article out of the
assistant at once.
"""

from __future__ import annotations

import io
import uuid
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import select

from api.deps.bot import BOT_ALLOWED_ROUTES
from core.knowledge.indexer import reindex
from core.models import AuditLog, KbArticleVersion
from core.models.enums import UserRole
from core.models.knowledge import PublishedVersionImmutableError
from core.repositories import knowledge_base as kb

from .test_bot_diary_contract import _bot_headers, _linked

CLINICAL = "/api/v1/knowledge-base/clinical-articles"
PRODUCT = "/api/v1/admin/knowledge-base/product-articles"
TEXT = "/api/v1/knowledge-base/article-text"
READ = "/api/v1/knowledge-base/articles"

BODY = (
    "## Короткий ответ\n\nПеред забором крови ребёнок пьёт воду как обычно.\n\n"
    "## Подробно\n\nВозьмите с собой дневник кетоцентрической терапии."
)
DOSE_BODY = "## Лекарства\n\nОбычно это безопасно. Давайте 300 мг утром."


def _article(title: str = "Анализы крови натощак", body: str = BODY) -> dict:
    return {"title": title, "body_md": body, "sources": "https://example.org/guide"}


@pytest.fixture
async def doctor(make_user):
    return await make_user(UserRole.DOCTOR)


@pytest.fixture
async def dietitian(make_user):
    return await make_user(UserRole.DIETITIAN)


@pytest.fixture
async def admin(make_user):
    return await make_user(UserRole.ADMIN)


async def _create(client, headers, payload: dict | None = None) -> dict:
    response = await client.post(CLINICAL, json=payload or _article(), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _submitted(client, author_headers, payload: dict | None = None) -> dict:
    created = await _create(client, author_headers, payload)
    response = await client.post(f"{CLINICAL}/{created['id']}/submit", headers=author_headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _published(client, author_headers, reviewer_headers, payload=None) -> dict:
    submitted = await _submitted(client, author_headers, payload)
    response = await client.post(
        f"{CLINICAL}/{submitted['id']}/publish",
        json={"content_hash": submitted["working_version"]["content_hash"]},
        headers=reviewer_headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestClinicalAccess:
    @pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.PARENT])
    async def test_list_is_refused_to_admin_and_parent(
        self, client, make_user, auth_headers, role
    ) -> None:
        response = await client.get(CLINICAL, headers=auth_headers(await make_user(role)))

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"

    async def test_admin_cannot_read_create_or_count(
        self, client, doctor, admin, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))
        headers = auth_headers(admin)

        assert (await client.get(f"{CLINICAL}/{created['id']}", headers=headers)).status_code == 403
        assert (await client.post(CLINICAL, json=_article(), headers=headers)).status_code == 403
        assert (await client.get(f"{CLINICAL}/review-count", headers=headers)).status_code == 403

    async def test_anonymous_is_refused(self, client) -> None:
        assert (await client.get(CLINICAL)).status_code == 401
        assert (await client.post(CLINICAL, json=_article())).status_code == 401

    async def test_bot_is_refused(self, client, session, make_user, make_patient) -> None:
        _, _, link, secret = await _linked(session, make_user, make_patient, chat_id=555_078_001)
        headers = await _bot_headers(client, link, secret)

        response = await client.get(CLINICAL, headers=headers)

        assert response.status_code == 403
        assert not any("clinical-articles" in path for _, path in BOT_ALLOWED_ROUTES)
        assert not any("product-articles" in path for _, path in BOT_ALLOWED_ROUTES)

    async def test_admin_journal_hides_clinical_payload(
        self, client, doctor, admin, auth_headers
    ) -> None:
        """The fact is visible («who, what, when»), the clinical text is not."""

        await _create(client, auth_headers(doctor))

        page = (
            await client.get(
                "/api/v1/admin/audit-log?entity=kb_clinical_articles", headers=auth_headers(admin)
            )
        ).json()

        entry = page["items"][0]
        assert entry["action"] == "create"
        assert entry["payload_hidden"] is True
        assert entry["after"] is None


class TestClinicalDraft:
    async def test_create_returns_the_draft(self, client, doctor, auth_headers) -> None:
        body = await _create(client, auth_headers(doctor))

        assert body["slug"] == "analizy-krovi-natoshchak"
        assert body["kind"] == "clinical"
        assert body["origin"] == "cabinet"
        assert body["status"] == "draft"
        assert body["is_live"] is False
        assert body["working_version_number"] == 1
        assert body["working_author_id"] == str(doctor.id)
        assert body["working_author_name"] == doctor.full_name
        assert body["working_version"]["body_md"] == BODY
        assert body["working_version"]["sources"] == "https://example.org/guide"
        assert len(body["working_version"]["content_hash"]) == 64
        assert body["warnings"] == []
        assert body["can"] == {
            "edit": True,
            "submit": True,
            "publish": False,
            "return_to_author": False,
            "withdraw": False,
            "new_version": False,
            "hide": False,
            "show": False,
            "discard": True,
        }

    async def test_contract_shape(self, client, dietitian, auth_headers) -> None:
        """Fields the cabinet reads; adding one is fine, removing is not."""

        body = await _create(client, auth_headers(dietitian))

        assert {
            "id",
            "slug",
            "kind",
            "origin",
            "status",
            "hidden",
            "title",
            "is_live",
            "live_version_number",
            "working_version_number",
            "working_author_id",
            "working_author_name",
            "submitted_at",
            "updated_at",
            "awaiting_my_review",
            "working_version",
            "versions",
            "warnings",
            "can",
        } <= set(body)
        assert {
            "id",
            "number",
            "title",
            "body_md",
            "sources",
            "author_name",
            "approver_name",
            "approved_at",
            "return_comment",
            "returned_by_name",
            "source_file_name",
            "content_hash",
            "is_live",
        } <= set(body["working_version"])

    async def test_same_title_gets_a_suffix(self, client, doctor, auth_headers) -> None:
        first = await _create(client, auth_headers(doctor))
        second = await _create(client, auth_headers(doctor))

        assert second["slug"] == f"{first['slug']}-2"

    async def test_slug_taken_in_between_moves_to_the_next_suffix(
        self, client, doctor, auth_headers, monkeypatch
    ) -> None:
        """Check-then-insert: another create may take the name between the two.
        The next suffix, not a 500 and a lost draft."""

        from core.repositories import kb_articles as kb_articles_repo

        first = await _create(client, auth_headers(doctor))

        async def never_taken(_session, _slug: str) -> bool:
            return False

        monkeypatch.setattr(kb_articles_repo, "slug_exists", never_taken)
        second = await client.post(CLINICAL, json=_article(), headers=auth_headers(doctor))

        assert second.status_code == 201, second.text
        assert second.json()["slug"] == f"{first['slug']}-2"

    async def test_slug_of_a_release_file_is_not_taken(
        self, client, doctor, auth_headers, monkeypatch
    ) -> None:
        """A cabinet article never takes the name of a shipped article file —
        the release sync would have to skip that file."""

        from core.repositories import kb_articles as kb_articles_repo

        async def never_taken(_session, _slug: str) -> bool:
            return False

        monkeypatch.setattr(kb_articles_repo, "slug_exists", never_taken)
        response = await client.post(
            CLINICAL, json=_article(title="how to mark eaten"), headers=auth_headers(doctor)
        )

        assert response.status_code == 201, response.text
        assert response.json()["slug"] == "how-to-mark-eaten-2"

    async def test_writes_take_the_index_lock(
        self, client, session, doctor, dietitian, auth_headers
    ) -> None:
        """The lock the release sync holds: a publish during a deploy waits for
        the sync instead of being undone by its stale objects."""

        from sqlalchemy import text

        from core.knowledge.indexer import INDEX_LOCK_KEY

        await _published(client, auth_headers(doctor), auth_headers(dietitian))

        held = await session.scalar(
            text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
                "AND pid = pg_backend_pid() AND classid = 0 AND objid = :key AND granted"
            ),
            {"key": INDEX_LOCK_KEY},
        )
        assert held == 1

    async def test_slug_does_not_follow_the_title(self, client, doctor, auth_headers) -> None:
        created = await _create(client, auth_headers(doctor))

        updated = await client.put(
            f"{CLINICAL}/{created['id']}",
            json=_article(title="Совсем другой заголовок"),
            headers=auth_headers(doctor),
        )

        assert updated.status_code == 200, updated.text
        assert updated.json()["slug"] == created["slug"]
        assert updated.json()["title"] == "Совсем другой заголовок"

    @pytest.mark.parametrize(
        "payload",
        [
            {"title": "", "body_md": "Текст."},
            {"title": "   ", "body_md": "Текст."},
            {"title": "Заголовок", "body_md": ""},
            {"title": "Заголовок"},
            {"title": "x" * 256, "body_md": "Текст."},
        ],
    )
    async def test_invalid_payload(self, client, doctor, auth_headers, payload) -> None:
        response = await client.post(CLINICAL, json=payload, headers=auth_headers(doctor))

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_article_is_not_found(self, client, doctor, auth_headers) -> None:
        response = await client.get(f"{CLINICAL}/{uuid.uuid4()}", headers=auth_headers(doctor))

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"

    async def test_malformed_id_is_a_validation_error(self, client, doctor, auth_headers) -> None:
        response = await client.get(f"{CLINICAL}/not-a-uuid", headers=auth_headers(doctor))

        assert response.status_code == 422

    async def test_only_the_author_edits_the_draft(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.put(
            f"{CLINICAL}/{created['id']}", json=_article(), headers=auth_headers(dietitian)
        )

        assert response.status_code == 403

    async def test_specialists_see_each_others_drafts(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.get(f"{CLINICAL}/{created['id']}", headers=auth_headers(dietitian))

        assert response.status_code == 200
        assert response.json()["can"]["edit"] is False


class TestFourEyes:
    async def test_submit_moves_to_review_and_shows_warnings(
        self, client, doctor, auth_headers
    ) -> None:
        submitted = await _submitted(
            client, auth_headers(doctor), _article(title="Лекарства", body=DOSE_BODY)
        )

        assert submitted["status"] == "review"
        assert submitted["working_version"]["submitted_at"] is not None
        assert submitted["warnings"] == [
            {
                "section": "Лекарства › Лекарства",
                "sentence": "Давайте 300 мг утром.",
                "kind": "dosing",
                "rule": "число + единица дозы",
            }
        ]
        # The author does not review himself.
        assert submitted["can"]["publish"] is False

    async def test_warnings_do_not_block_publication(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(
            client,
            auth_headers(doctor),
            auth_headers(dietitian),
            _article(title="Лекарства", body=DOSE_BODY),
        )

        assert published["status"] == "published"
        assert published["warnings"] == []

    async def test_author_cannot_publish(self, client, doctor, auth_headers) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/publish",
            json={"content_hash": submitted["working_version"]["content_hash"]},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "conflict"
        assert error["details"]["reason"] == "four_eyes"
        assert "другой специалист" in error["message"]

    async def test_another_specialist_publishes(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))

        assert published["status"] == "published"
        assert published["is_live"] is True
        assert published["live_version_number"] == 1
        version = published["working_version"]
        assert version["reviewed_by"] == str(dietitian.id)
        assert version["approver_name"] == dietitian.full_name
        assert version["approved_at"] is not None
        assert version["is_live"] is True
        # The list names who put the article in front of families.
        assert published["live_approver_name"] == dietitian.full_name
        assert published["live_approved_at"] == version["approved_at"]
        listed = await client.get(
            "/api/v1/knowledge-base/clinical-articles", headers=auth_headers(doctor)
        )
        row = next(item for item in listed.json()["items"] if item["id"] == published["id"])
        assert row["live_approver_name"] == dietitian.full_name

    async def test_published_article_reaches_the_assistant(
        self, client, session, doctor, dietitian, make_user, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))

        found = await kb.search(session, q="кетоцентрической терапии")
        assert published["slug"] in {passage.doc_slug for passage in found}
        response = await client.get(
            f"{READ}/{published['slug']}", headers=auth_headers(await make_user(UserRole.PARENT))
        )
        assert response.status_code == 200, response.text
        assert response.json()["kind"] == "clinical"
        assert "Перед забором крови" in response.json()["body_md"]

    async def test_publish_needs_the_text_the_reviewer_saw(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/publish",
            json={"content_hash": "0" * 64},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"]["reason"] == "content_changed"

    async def test_publish_needs_a_hash(self, client, doctor, dietitian, auth_headers) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/publish", json={}, headers=auth_headers(dietitian)
        )

        assert response.status_code == 422

    async def test_draft_is_not_published_before_review(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{created['id']}/publish",
            json={"content_hash": created["working_version"]["content_hash"]},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 409

    async def test_return_with_comment(self, client, doctor, dietitian, auth_headers) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/return",
            json={
                "content_hash": submitted["working_version"]["content_hash"],
                "comment": "Уточните, сколько воды.",
            },
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "draft"
        assert body["working_version"]["return_comment"] == "Уточните, сколько воды."
        assert body["working_version"]["returned_by_name"] == dietitian.full_name
        assert body["working_version"]["submitted_at"] is None

    async def test_author_cannot_return_to_himself(self, client, doctor, auth_headers) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/return",
            json={"content_hash": submitted["working_version"]["content_hash"], "comment": "x"},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"]["reason"] == "four_eyes"

    async def test_return_needs_a_comment(self, client, doctor, dietitian, auth_headers) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/return",
            json={"content_hash": submitted["working_version"]["content_hash"], "comment": "  "},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422

    async def test_editing_on_review_makes_it_a_draft_again(
        self, client, doctor, auth_headers
    ) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.put(
            f"{CLINICAL}/{submitted['id']}",
            json=_article(body=BODY + "\n\nДобавка."),
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "draft"
        assert (
            response.json()["working_version"]["content_hash"]
            != (submitted["working_version"]["content_hash"])
        )

    async def test_submit_twice_is_a_conflict(self, client, doctor, auth_headers) -> None:
        submitted = await _submitted(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/submit", headers=auth_headers(doctor)
        )

        assert response.status_code == 409

    async def test_review_queue_and_badge(self, client, doctor, dietitian, auth_headers) -> None:
        mine = await _submitted(client, auth_headers(doctor))
        theirs = await _submitted(client, auth_headers(dietitian), _article(title="Чужая статья"))

        queue = (
            await client.get(f"{CLINICAL}?awaiting_my_review=true", headers=auth_headers(doctor))
        ).json()
        count = (await client.get(f"{CLINICAL}/review-count", headers=auth_headers(doctor))).json()

        ids = {item["id"] for item in queue["items"]}
        assert theirs["id"] in ids
        assert mine["id"] not in ids
        assert all(item["awaiting_my_review"] for item in queue["items"])
        assert count["count"] == queue["total"] >= 1

    async def test_list_filters_by_status(self, client, doctor, auth_headers) -> None:
        draft = await _create(client, auth_headers(doctor))
        submitted = await _submitted(client, auth_headers(doctor), _article(title="Вторая"))

        page = (await client.get(f"{CLINICAL}?status=review", headers=auth_headers(doctor))).json()

        ids = {item["id"] for item in page["items"]}
        assert submitted["id"] in ids
        assert draft["id"] not in ids
        assert all(item["status"] == "review" for item in page["items"])

    async def test_live_filter_keeps_an_article_under_correction(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        """«Опубликованные» means «the assistant answers by it now»: an article
        whose new version is a draft is still live, though its working state is
        a draft."""

        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        await client.post(f"{CLINICAL}/{published['id']}/new-version", headers=auth_headers(doctor))
        draft = await _create(client, auth_headers(doctor), _article(title="Не опубликована"))

        live = (await client.get(f"{CLINICAL}?live=true", headers=auth_headers(doctor))).json()
        by_status = (
            await client.get(f"{CLINICAL}?status=published", headers=auth_headers(doctor))
        ).json()

        live_ids = {item["id"] for item in live["items"]}
        assert published["id"] in live_ids
        assert draft["id"] not in live_ids
        assert all(item["is_live"] for item in live["items"])
        assert published["id"] not in {item["id"] for item in by_status["items"]}

    async def test_list_pagination(self, client, doctor, auth_headers) -> None:
        await _create(client, auth_headers(doctor))
        await _create(client, auth_headers(doctor), _article(title="Ещё одна"))

        page = (await client.get(f"{CLINICAL}?limit=1", headers=auth_headers(doctor))).json()

        assert len(page["items"]) == 1
        assert page["total"] >= 2
        bad = await client.get(f"{CLINICAL}?status=unknown", headers=auth_headers(doctor))
        assert bad.status_code == 422


class TestPublishedVersions:
    async def test_published_version_is_not_edited(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))

        response = await client.put(
            f"{CLINICAL}/{published['id']}", json=_article(), headers=auth_headers(doctor)
        )

        assert response.status_code == 409

    async def test_published_row_refuses_update_in_the_database(
        self, client, session, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        version = await session.get(KbArticleVersion, uuid.UUID(published["working_version"]["id"]))
        assert version is not None

        version.body_md = "подмена"
        with pytest.raises(PublishedVersionImmutableError):
            await session.flush()

    async def test_new_version_keeps_the_published_one_live(
        self, client, doctor, dietitian, make_user, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        parent = auth_headers(await make_user(UserRole.PARENT))

        started = await client.post(
            f"{CLINICAL}/{published['id']}/new-version", headers=auth_headers(dietitian)
        )
        assert started.status_code == 200, started.text
        draft = started.json()
        assert draft["status"] == "draft"
        assert draft["is_live"] is True
        assert draft["working_version_number"] == 2
        assert draft["working_author_id"] == str(dietitian.id)
        assert draft["live_version_number"] == 1

        edited = await client.put(
            f"{CLINICAL}/{published['id']}",
            json=_article(body="## Короткий ответ\n\nНовый текст про анализы."),
            headers=auth_headers(dietitian),
        )
        assert edited.status_code == 200, edited.text
        live = (await client.get(f"{READ}/{published['slug']}", headers=parent)).json()
        assert "Перед забором крови" in live["body_md"]

        submitted = (
            await client.post(
                f"{CLINICAL}/{published['id']}/submit", headers=auth_headers(dietitian)
            )
        ).json()
        republished = await client.post(
            f"{CLINICAL}/{published['id']}/publish",
            json={"content_hash": submitted["working_version"]["content_hash"]},
            headers=auth_headers(doctor),
        )
        assert republished.status_code == 200, republished.text
        assert republished.json()["live_version_number"] == 2
        history = republished.json()["versions"]
        assert [v["number"] for v in history] == [2, 1]
        assert history[1]["approved_at"] == published["working_version"]["approved_at"]
        assert history[1]["body_md"] == BODY
        live = (await client.get(f"{READ}/{published['slug']}", headers=parent)).json()
        assert live["body_md"] == "## Короткий ответ\n\nНовый текст про анализы."

    async def test_new_version_while_a_draft_exists_is_a_conflict(
        self, client, doctor, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{created['id']}/new-version", headers=auth_headers(doctor)
        )

        assert response.status_code == 409

    async def test_withdraw_removes_it_from_the_assistant_at_once(
        self, client, session, doctor, dietitian, make_user, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))

        response = await client.post(
            f"{CLINICAL}/{published['id']}/withdraw", headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "withdrawn"
        assert response.json()["is_live"] is False
        read = await client.get(
            f"{READ}/{published['slug']}", headers=auth_headers(await make_user(UserRole.PARENT))
        )
        assert read.status_code == 404
        found = await kb.search(session, q="кетоцентрической терапии")
        assert published["slug"] not in {passage.doc_slug for passage in found}

    async def test_withdraw_twice_is_a_conflict(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        await client.post(f"{CLINICAL}/{published['id']}/withdraw", headers=auth_headers(doctor))

        again = await client.post(
            f"{CLINICAL}/{published['id']}/withdraw", headers=auth_headers(doctor)
        )

        assert again.status_code == 409

    async def test_every_write_is_journalled(
        self, client, session, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))

        actions = (
            await session.scalars(
                select(AuditLog.action)
                .where(
                    AuditLog.entity == "kb_clinical_articles",
                    AuditLog.entity_id == uuid.UUID(published["id"]),
                )
                .order_by(AuditLog.created_at)
            )
        ).all()

        assert list(actions) == ["create", "submit", "publish"]


class TestDiscardDraft:
    """An «Изменить» clicked by mistake, or a colleague's abandoned draft, must
    not lock the article for the whole clinic."""

    async def test_author_discards_a_new_article(
        self, client, session, doctor, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{created['id']}/discard-draft", headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"deleted": True, "article": None}
        gone = await client.get(f"{CLINICAL}/{created['id']}", headers=auth_headers(doctor))
        assert gone.status_code == 404
        entry = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.entity == "kb_clinical_articles",
                    AuditLog.entity_id == uuid.UUID(created["id"]),
                    AuditLog.action == "discard_draft",
                )
            )
        ).one()
        # The discarded text is kept in the trail: the version row is gone.
        assert entry.before is not None and entry.before["body_md"] == BODY
        assert entry.after is None

    async def test_colleague_discards_an_abandoned_new_version(
        self, client, doctor, dietitian, make_user, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        started = (
            await client.post(
                f"{CLINICAL}/{published['id']}/new-version", headers=auth_headers(doctor)
            )
        ).json()
        await client.put(
            f"{CLINICAL}/{published['id']}",
            json=_article(title="Черновой заголовок"),
            headers=auth_headers(doctor),
        )
        assert started["can"]["discard"] is True
        other = await make_user(UserRole.DOCTOR)
        seen = await client.get(f"{CLINICAL}/{published['id']}", headers=auth_headers(other))
        assert seen.json()["can"]["discard"] is True
        assert seen.json()["can"]["new_version"] is False

        response = await client.post(
            f"{CLINICAL}/{published['id']}/discard-draft", headers=auth_headers(other)
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["deleted"] is False
        article = body["article"]
        assert article["status"] == "published"
        assert article["title"] == published["title"]
        assert article["working_version_number"] == 1
        assert article["live_version_number"] == 1
        assert article["can"]["new_version"] is True
        parent = auth_headers(await make_user(UserRole.PARENT))
        live = (await client.get(f"{READ}/{published['slug']}", headers=parent)).json()
        assert "Перед забором крови" in live["body_md"]

    async def test_withdrawn_article_stays_withdrawn(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        await client.post(f"{CLINICAL}/{published['id']}/withdraw", headers=auth_headers(doctor))
        await client.post(f"{CLINICAL}/{published['id']}/new-version", headers=auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{published['id']}/discard-draft", headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        assert response.json()["article"]["status"] == "withdrawn"
        assert response.json()["article"]["is_live"] is False

    async def test_only_the_author_discards_a_version_on_review(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        submitted = await _submitted(client, auth_headers(doctor))
        assert submitted["can"]["discard"] is True
        seen = (
            await client.get(f"{CLINICAL}/{submitted['id']}", headers=auth_headers(dietitian))
        ).json()
        assert seen["can"]["discard"] is False

        response = await client.post(
            f"{CLINICAL}/{submitted['id']}/discard-draft", headers=auth_headers(dietitian)
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"

    async def test_published_version_is_not_discarded(
        self, client, doctor, dietitian, auth_headers
    ) -> None:
        published = await _published(client, auth_headers(doctor), auth_headers(dietitian))
        assert published["can"]["discard"] is False

        response = await client.post(
            f"{CLINICAL}/{published['id']}/discard-draft", headers=auth_headers(doctor)
        )

        assert response.status_code == 409

    @pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.PARENT])
    async def test_refused_outside_the_specialists(
        self, client, doctor, make_user, auth_headers, role
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.post(
            f"{CLINICAL}/{created['id']}/discard-draft",
            headers=auth_headers(await make_user(role)),
        )

        assert response.status_code == 403

    async def test_anonymous_and_unknown(self, client, doctor, auth_headers) -> None:
        assert (await client.post(f"{CLINICAL}/{uuid.uuid4()}/discard-draft")).status_code == 401
        missing = await client.post(
            f"{CLINICAL}/{uuid.uuid4()}/discard-draft", headers=auth_headers(doctor)
        )
        assert missing.status_code == 404
        malformed = await client.post(
            f"{CLINICAL}/not-a-uuid/discard-draft", headers=auth_headers(doctor)
        )
        assert malformed.status_code == 422


@pytest.fixture
def release(tmp_path: Path) -> Path:
    directory = tmp_path / "product"
    directory.mkdir()
    (directory / "how-to-test-builtin.md").write_text(
        "---\nid: how-to-test-builtin\ntitle: Встроенная статья\nkind: product\n"
        "status: approved\nversion: 1\nsource: docs/TZ_AI_AGENTS.md#10.4\n---\n\n"
        "# Встроенная статья\n\n## Коротко\n\nКнопка «Синхрофазотрон» открывает раздел.\n",
        encoding="utf-8",
    )
    return tmp_path


async def _builtin(session, release: Path) -> None:
    report = await reindex(session, root=release)
    assert report.ok, report.errors


class TestProductArticles:
    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT])
    async def test_only_the_administrator(self, client, make_user, auth_headers, role) -> None:
        headers = auth_headers(await make_user(role))

        assert (await client.get(PRODUCT, headers=headers)).status_code == 403
        assert (await client.post(PRODUCT, json=_article(), headers=headers)).status_code == 403

    async def test_anonymous_is_refused(self, client) -> None:
        assert (await client.get(PRODUCT)).status_code == 401

    async def test_list_shows_builtin_read_only(
        self, client, session, admin, auth_headers, release
    ) -> None:
        await _builtin(session, release)

        page = (await client.get(f"{PRODUCT}?origin=builtin", headers=auth_headers(admin))).json()

        item = next(i for i in page["items"] if i["slug"] == "how-to-test-builtin")
        assert item["origin"] == "builtin"
        assert item["status"] == "published"
        assert item["working_author_name"] == "KetoCare"
        detail = (await client.get(f"{PRODUCT}/{item['id']}", headers=auth_headers(admin))).json()
        assert detail["can"]["edit"] is False
        assert detail["can"]["hide"] is True

    async def test_clinical_article_is_not_found_here(
        self, client, doctor, admin, auth_headers
    ) -> None:
        created = await _create(client, auth_headers(doctor))

        response = await client.get(f"{PRODUCT}/{created['id']}", headers=auth_headers(admin))

        assert response.status_code == 404

    async def test_product_article_is_not_found_on_the_clinical_route(
        self, client, doctor, admin, auth_headers
    ) -> None:
        created = (await client.post(PRODUCT, json=_article(), headers=auth_headers(admin))).json()

        response = await client.get(f"{CLINICAL}/{created['id']}", headers=auth_headers(doctor))

        assert response.status_code == 404

    async def test_hide_and_show_builtin(
        self, client, session, admin, make_user, auth_headers, release
    ) -> None:
        await _builtin(session, release)
        page = (await client.get(f"{PRODUCT}?origin=builtin", headers=auth_headers(admin))).json()
        article_id = next(i["id"] for i in page["items"] if i["slug"] == "how-to-test-builtin")
        parent = auth_headers(await make_user(UserRole.PARENT))

        hidden = await client.post(f"{PRODUCT}/{article_id}/hide", headers=auth_headers(admin))
        assert hidden.status_code == 200, hidden.text
        assert hidden.json()["hidden"] is True
        assert (await client.get(f"{READ}/how-to-test-builtin", headers=parent)).status_code == 404
        assert await kb.search(session, q="синхрофазотрон") == []
        again = await client.post(f"{PRODUCT}/{article_id}/hide", headers=auth_headers(admin))
        assert again.status_code == 409

        shown = await client.post(f"{PRODUCT}/{article_id}/show", headers=auth_headers(admin))
        assert shown.status_code == 200, shown.text
        assert (await client.get(f"{READ}/how-to-test-builtin", headers=parent)).status_code == 200

    async def test_builtin_is_not_edited_or_withdrawn(
        self, client, session, admin, auth_headers, release
    ) -> None:
        await _builtin(session, release)
        page = (await client.get(f"{PRODUCT}?origin=builtin", headers=auth_headers(admin))).json()
        article_id = next(i["id"] for i in page["items"] if i["slug"] == "how-to-test-builtin")
        headers = auth_headers(admin)

        assert (
            await client.put(f"{PRODUCT}/{article_id}", json=_article(), headers=headers)
        ).status_code == 409
        assert (
            await client.post(f"{PRODUCT}/{article_id}/withdraw", headers=headers)
        ).status_code == 409
        assert (
            await client.post(f"{PRODUCT}/{article_id}/new-version", headers=headers)
        ).status_code == 409

    async def test_own_article_is_published_by_the_administrator(
        self, client, session, admin, make_user, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        created = await client.post(
            PRODUCT,
            json=_article(
                title="Где кнопка печати", body="## Коротко\n\nКнопка «Печатофон» в шапке."
            ),
            headers=headers,
        )
        assert created.status_code == 201, created.text
        article = created.json()
        assert article["origin"] == "cabinet"
        assert article["kind"] == "product"
        assert article["can"]["publish"] is True

        published = await client.post(
            f"{PRODUCT}/{article['id']}/publish",
            json={"content_hash": article["working_version"]["content_hash"]},
            headers=headers,
        )
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"
        assert published.json()["working_version"]["reviewed_by"] == str(admin.id)
        parent = auth_headers(await make_user(UserRole.PARENT))
        assert (await client.get(f"{READ}/{article['slug']}", headers=parent)).status_code == 200

        withdrawn = await client.post(f"{PRODUCT}/{article['id']}/withdraw", headers=headers)
        assert withdrawn.status_code == 200, withdrawn.text
        assert (await client.get(f"{READ}/{article['slug']}", headers=parent)).status_code == 404

        restarted = await client.post(f"{PRODUCT}/{article['id']}/new-version", headers=headers)
        assert restarted.status_code == 200, restarted.text
        assert restarted.json()["working_version_number"] == 2

    async def test_own_draft_is_edited(self, client, admin, auth_headers) -> None:
        headers = auth_headers(admin)
        article = (await client.post(PRODUCT, json=_article(), headers=headers)).json()

        response = await client.put(
            f"{PRODUCT}/{article['id']}", json=_article(title="Новый заголовок"), headers=headers
        )

        assert response.status_code == 200, response.text
        assert response.json()["title"] == "Новый заголовок"

    async def test_unknown_article_is_not_found(self, client, admin, auth_headers) -> None:
        response = await client.post(f"{PRODUCT}/{uuid.uuid4()}/hide", headers=auth_headers(admin))

        assert response.status_code == 404

    @pytest.mark.parametrize(
        "payload",
        [
            {"title": "", "body_md": "Текст."},
            {"title": "Заголовок", "body_md": "   "},
            {"title": "Заголовок"},
            {"title": "x" * 256, "body_md": "Текст."},
            {"title": "Заголовок", "body_md": "x" * 100_001},
        ],
    )
    async def test_invalid_payload(self, client, admin, auth_headers, payload) -> None:
        headers = auth_headers(admin)
        created = await client.post(PRODUCT, json=payload, headers=headers)
        assert created.status_code == 422
        assert created.json()["error"]["code"] == "validation_error"

        article = (await client.post(PRODUCT, json=_article(), headers=headers)).json()
        updated = await client.put(f"{PRODUCT}/{article['id']}", json=payload, headers=headers)
        assert updated.status_code == 422

    @pytest.mark.parametrize("payload", [{}, {"content_hash": "abc"}, {"content_hash": "Z" * 64}])
    async def test_publish_needs_a_valid_hash(self, client, admin, auth_headers, payload) -> None:
        headers = auth_headers(admin)
        article = (await client.post(PRODUCT, json=_article(), headers=headers)).json()

        response = await client.post(
            f"{PRODUCT}/{article['id']}/publish", json=payload, headers=headers
        )

        assert response.status_code == 422

    async def test_publish_needs_the_text_the_administrator_saw(
        self, client, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        article = (await client.post(PRODUCT, json=_article(), headers=headers)).json()
        seen = article["working_version"]["content_hash"]
        await client.put(
            f"{PRODUCT}/{article['id']}",
            json=_article(title="Правка после чтения"),
            headers=headers,
        )

        response = await client.post(
            f"{PRODUCT}/{article['id']}/publish", json={"content_hash": seen}, headers=headers
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"]["reason"] == "content_changed"

    async def test_own_draft_is_discarded(self, client, admin, auth_headers) -> None:
        headers = auth_headers(admin)
        article = (await client.post(PRODUCT, json=_article(), headers=headers)).json()
        assert article["can"]["discard"] is True

        response = await client.post(f"{PRODUCT}/{article['id']}/discard-draft", headers=headers)

        assert response.status_code == 200, response.text
        assert response.json()["deleted"] is True
        assert (await client.get(f"{PRODUCT}/{article['id']}", headers=headers)).status_code == 404

    async def test_builtin_is_not_discarded(
        self, client, session, admin, auth_headers, release
    ) -> None:
        await _builtin(session, release)
        headers = auth_headers(admin)
        page = (await client.get(f"{PRODUCT}?origin=builtin", headers=headers)).json()
        article_id = next(i["id"] for i in page["items"] if i["slug"] == "how-to-test-builtin")

        response = await client.post(f"{PRODUCT}/{article_id}/discard-draft", headers=headers)

        assert response.status_code == 409

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN])
    async def test_specialists_do_not_discard_product_drafts(
        self, client, admin, make_user, auth_headers, role
    ) -> None:
        article = (await client.post(PRODUCT, json=_article(), headers=auth_headers(admin))).json()

        response = await client.post(
            f"{PRODUCT}/{article['id']}/discard-draft",
            headers=auth_headers(await make_user(role)),
        )

        assert response.status_code == 403

    async def test_journal_shows_product_payload(self, client, admin, auth_headers) -> None:
        headers = auth_headers(admin)
        await client.post(PRODUCT, json=_article(), headers=headers)

        page = (
            await client.get("/api/v1/admin/audit-log?entity=kb_product_articles", headers=headers)
        ).json()

        entry = page["items"][0]
        assert entry["payload_hidden"] is False
        assert entry["after"]["body_md"] == BODY


def _docx() -> bytes:
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    document = (
        f'<w:document xmlns:w="{w}"><w:body>'
        '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Раздел</w:t></w:r></w:p>'
        "<w:p><w:r><w:t>Текст статьи.</w:t></w:r></w:p>"
        "</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


def _docx_stored() -> bytes:
    """`_docx` without compression: its text bytes can be damaged in place."""

    buffer = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(_docx())) as source,
        zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as target,
    ):
        for item in source.infolist():
            target.writestr(item.filename, source.read(item))
    return buffer.getvalue()


class TestArticleText:
    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.ADMIN])
    async def test_word_is_converted(self, client, make_user, auth_headers, role) -> None:
        response = await client.post(
            TEXT,
            files={"file": ("статья.docx", _docx(), "application/octet-stream")},
            headers=auth_headers(await make_user(role)),
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "title": None,
            "body_md": "## Раздел\n\nТекст статьи.",
            "source_file_name": "статья.docx",
        }

    async def test_pdf_is_refused_with_a_way_out(self, client, doctor, auth_headers) -> None:
        response = await client.post(
            TEXT,
            files={"file": ("a.pdf", b"%PDF-1.7", "application/pdf")},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422
        assert ".docx" in response.json()["error"]["message"]

    async def test_parent_is_refused(self, client, make_user, auth_headers) -> None:
        response = await client.post(
            TEXT,
            files={"file": ("a.docx", _docx(), "application/octet-stream")},
            headers=auth_headers(await make_user(UserRole.PARENT)),
        )

        assert response.status_code == 403

    async def test_anonymous_is_refused(self, client) -> None:
        response = await client.post(
            TEXT, files={"file": ("a.docx", _docx(), "application/octet-stream")}
        )

        assert response.status_code == 401

    async def test_damaged_word_file_is_refused_not_a_500(
        self, client, doctor, auth_headers
    ) -> None:
        raw = bytearray(_docx_stored())
        at = raw.index("Текст".encode())
        raw[at] ^= 0x01

        response = await client.post(
            TEXT,
            files={"file": ("a.docx", bytes(raw), "application/octet-stream")},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_file_is_required(self, client, doctor, auth_headers) -> None:
        response = await client.post(TEXT, headers=auth_headers(doctor))

        assert response.status_code == 422
