"""`GET /knowledge-base/articles/{slug}` — the article behind a source link.

Consumers: the source links under an assistant reply in the Mini App
(`apps/miniapp/src/features/assistant`) and in the family cabinet
(`apps/web/src/features/assistant`). Both open the article named in
`source_articles[].slug` and render `title` as the heading and `body_md` as the
text. Their tests run against a fake API, so the shape is pinned here, on the
supplier side.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from api.deps.bot import BOT_ALLOWED_ROUTES
from core.knowledge.documents import read_article, split_article
from core.models import KbChunk
from core.models.enums import UserRole

from .test_bot_diary_contract import _bot_headers, _linked
from .test_miniapp_auth import _linked_family, bot_token, init_data  # noqa: F401

URL = "/api/v1/knowledge-base/articles"
ROUTE = "/knowledge-base/articles/{slug}"
KB_ROOT = Path(__file__).resolve().parents[3] / "docs" / "knowledge-base"


def _chunk(slug: str, title: str, ord_: int, heading: str, body: str, kind: str) -> KbChunk:
    return KbChunk(
        doc_slug=slug,
        doc_title=title,
        heading_path=f"{title} › {heading}",
        ord=ord_,
        body=body,
        kind=kind,
        source_path=f"docs/knowledge-base/{kind}/{slug}.md",
        source_sha256="0" * 64,
    )


async def _seed(session, *, kind: str = "product") -> str:
    slug = f"plan-day-{uuid.uuid4().hex[:8]}"
    title = "Как составить день"
    # Inserted out of order: the text must follow `ord`, not insertion.
    session.add_all(
        [
            _chunk(slug, title, 1, "Подробно", "Второй раздел.\n\n- пункт", kind),
            _chunk(slug, title, 0, "Короткий ответ", "Первый раздел.", kind),
        ]
    )
    await session.flush()
    return slug


async def test_article_is_assembled_from_its_sections(
    client, session, make_user, auth_headers
) -> None:
    slug = await _seed(session, kind="clinical")

    response = await client.get(
        f"{URL}/{slug}", headers=auth_headers(await make_user(UserRole.PARENT))
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "slug": slug,
        "title": "Как составить день",
        "kind": "clinical",
        "body_md": (
            "## Короткий ответ\n\nПервый раздел.\n\n## Подробно\n\nВторой раздел.\n\n- пункт"
        ),
    }


async def test_contract_shape_for_the_source_links(
    client, session, make_user, auth_headers
) -> None:
    """Fields the Mini App and the cabinet read; adding one is fine, removing is not."""

    slug = await _seed(session)

    body = (
        await client.get(f"{URL}/{slug}", headers=auth_headers(await make_user(UserRole.PARENT)))
    ).json()

    assert set(body) == {"slug", "title", "kind", "body_md"}
    assert body["kind"] in ("product", "clinical")
    assert all(isinstance(body[key], str) for key in ("slug", "title", "body_md"))


async def test_real_article_reads_like_its_file(client, session, make_user, auth_headers) -> None:
    """Indexed the way `make kb-index` indexes it, the article comes back as the
    file without the front matter and without the H1 title."""

    source = read_article(KB_ROOT / "product" / "how-to-mark-eaten.md", root=KB_ROOT)
    slug = f"real-{uuid.uuid4().hex[:8]}"
    session.add_all(
        KbChunk(
            doc_slug=slug,
            doc_title=source.title,
            heading_path=chunk.heading_path,
            ord=chunk.ord,
            body=chunk.body,
            kind=source.kind,
            source_path=source.path,
            source_sha256=source.sha256,
        )
        for chunk in split_article(source)
    )
    await session.flush()

    response = await client.get(
        f"{URL}/{slug}", headers=auth_headers(await make_user(UserRole.PARENT))
    )

    assert response.status_code == 200, response.text
    without_title = source.body.split("\n", 1)[1].strip()
    assert source.body.startswith("# ")
    assert response.json()["body_md"] == without_title


async def test_article_without_sections_has_no_title_in_body(
    client, session, make_user, auth_headers, tmp_path: Path
) -> None:
    """An article with only an H1 and text is indexed as one bare-title chunk
    whose body still starts with `# Title`. The screen prints `title` as the
    heading, so the H1 must not come back in `body_md` too."""

    slug = f"short-{uuid.uuid4().hex[:8]}"
    path = tmp_path / "product" / f"{slug}.md"
    path.parent.mkdir(parents=True)
    path.write_text(
        "---\n"
        f"id: {slug}\n"
        "title: Короткая статья\n"
        "kind: product\n"
        "status: approved\n"
        "version: 1\n"
        "source: docs/TZ_AI_AGENTS.md#10.4\n"
        "---\n\n"
        "# Короткая статья\n\n"
        "Только текст, без разделов.\n",
        encoding="utf-8",
    )
    source = read_article(path, root=tmp_path)
    chunks = split_article(source)
    assert [chunk.heading_path for chunk in chunks] == ["Короткая статья"]
    session.add_all(
        KbChunk(
            doc_slug=slug,
            doc_title=source.title,
            heading_path=chunk.heading_path,
            ord=chunk.ord,
            body=chunk.body,
            kind=source.kind,
            source_path=source.path,
            source_sha256=source.sha256,
        )
        for chunk in chunks
    )
    await session.flush()

    response = await client.get(
        f"{URL}/{slug}", headers=auth_headers(await make_user(UserRole.PARENT))
    )

    assert response.status_code == 200, response.text
    assert response.json()["body_md"] == "Только текст, без разделов."


@pytest.mark.parametrize(
    "role", [UserRole.PARENT, UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.ADMIN]
)
async def test_everyone_signed_in_reads(client, session, make_user, auth_headers, role) -> None:
    """Articles are public material, not patient data."""

    slug = await _seed(session)

    response = await client.get(f"{URL}/{slug}", headers=auth_headers(await make_user(role)))

    assert response.status_code == 200, response.text


async def test_unknown_article_is_not_found(client, make_user, auth_headers) -> None:
    response = await client.get(
        f"{URL}/no-such-article-{uuid.uuid4().hex[:8]}",
        headers=auth_headers(await make_user(UserRole.PARENT)),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("slug", ["Plan-Day", "plan_day", "план", "a" * 129, "a.b"])
async def test_malformed_slug_is_a_validation_error(client, make_user, auth_headers, slug) -> None:
    response = await client.get(
        f"{URL}/{slug}", headers=auth_headers(await make_user(UserRole.PARENT))
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_anonymous_is_refused(client, session) -> None:
    slug = await _seed(session)

    response = await client.get(f"{URL}/{slug}")

    assert response.status_code == 401


async def test_mini_app_session_reads(client, session, make_user, make_patient) -> None:
    await _linked_family(session, make_user, make_patient)
    opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
    assert opened.status_code == 200, opened.text
    slug = await _seed(session)

    response = await client.get(
        f"{URL}/{slug}", headers={"Authorization": f"Bearer {opened.json()['access_token']}"}
    )

    assert response.status_code == 200, response.text


def test_route_is_not_open_to_the_bot() -> None:
    assert ("GET", ROUTE) not in BOT_ALLOWED_ROUTES


async def test_bot_session_is_refused(client, session, make_user, make_patient) -> None:
    _, _, link, secret = await _linked(session, make_user, make_patient, chat_id=555_077_001)
    headers = await _bot_headers(client, link, secret)
    slug = await _seed(session)

    response = await client.get(f"{URL}/{slug}", headers=headers)

    assert response.status_code == 403
