"""Ссылки «по материалам» под ответом помощника — стык на стороне поставщика.

Потребители — подпись под ответом в кабинете
(`apps/web/src/features/assistant/AssistantPage.tsx`) и в Mini App
(`apps/miniapp/src/features/assistant/AssistantScreen.tsx`). Оба печатают
заголовки статей из `source_articles`. До этой правки экраны печатали
`sources` — имена файлов, и семья читала под ответом «how-to-plan-the-day».
Тесты экранов работают с подделкой ответа, поэтому форма поля проверяется здесь.
"""

from __future__ import annotations

import uuid

import pytest

from core.models import KbChunk
from core.models.enums import UserRole
from core.repositories import ai_conversations as conversations_repo
from core.repositories import patients as patients_repo
from core.schemas.ai_conversations import new_message

pytestmark = pytest.mark.asyncio


def _chunk(slug: str, title: str, ord_: int = 0) -> KbChunk:
    return KbChunk(
        doc_slug=slug,
        doc_title=title,
        heading_path="",
        ord=ord_,
        body="текст",
        kind="product",
        source_path=f"docs/knowledge-base/product/{slug}.md",
        source_sha256="0" * 64,
    )


async def test_reply_names_articles_by_title(
    client, session, make_user, make_patient, auth_headers, enqueued
) -> None:
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

    slug = f"plan-day-{uuid.uuid4().hex[:8]}"
    gone = f"gone-{uuid.uuid4().hex[:8]}"
    # Два куска одной статьи — одна ссылка, а не две.
    session.add_all([_chunk(slug, "Как составить день", 0), _chunk(slug, "Как составить день", 1)])
    await session.flush()

    accepted = await client.post(
        "/api/v1/ai/assistant/messages",
        json={"patient_id": str(patient.id), "text": "как составить день"},
        headers=auth_headers(parent),
    )
    assert accepted.status_code == 202, accepted.text
    conversation = await conversations_repo.get(
        session, uuid.UUID(accepted.json()["conversation_id"])
    )
    assert conversation is not None
    await conversations_repo.replace_message(
        session,
        conversation=conversation,
        message=new_message(seq=1, role="assistant", text="Ответ", sources=[slug, gone]),
    )
    await session.flush()

    response = await client.get(
        f"/api/v1/patients/{patient.id}/ai-conversations/{conversation.id}",
        headers=auth_headers(parent),
    )

    assert response.status_code == 200, response.text
    reply = response.json()["messages"][1]
    # Имена остаются — по ним ответ сверяют с журналом.
    assert reply["sources"] == [slug, gone]
    # Экраны печатают заголовок; статьи, которой в индексе нет, в перечне нет.
    assert reply["source_articles"] == [{"slug": slug, "title": "Как составить день"}]
    # У вопроса семьи ссылок нет, но поле есть: экраны читают его у каждого.
    assert response.json()["messages"][0]["source_articles"] == []
