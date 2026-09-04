"""Переписка семьи с помощником: чтение (раздел 10.4 ТЗ).

Кто что видит:

* **родитель** — только свои разговоры о своём ребёнке;
* **врач и диетолог** — переписку своих пациентов, на чтение (ТЗ называет
  врача; диетолог подбирает рацион по тем же вопросам, и закрывать ему то, что
  открыто врачу, значило бы заставить его спрашивать через врача);
* **администратор** — ничего: к клиническим данным он доступа не имеет
  (правило 5 `CLAUDE.md`), а переписка о ребёнке — клинические данные.

Чтение чужой переписки пишется в `audit_log`: правило 7 требует следа там, где
данные пациента покидают свой круг.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query

from core.models.enums import UserRole
from core.repositories import ai_conversations as conversations_repo
from core.repositories import audit as audit_repo

from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas import Page
from ..schemas_ai import ConversationListItem, ConversationRead, MessageRead

router = APIRouter(prefix="/patients/{patient_id}/ai-conversations", tags=["ai"])

PatientIdPath = Annotated[uuid.UUID, Path()]


@router.get("", response_model=Page[ConversationListItem], summary="Разговоры с помощником")
async def list_conversations(
    patient_id: PatientIdPath,
    session: SessionDep,
    user: PatientAccessDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ConversationListItem]:
    items, total = await conversations_repo.list_for_patient(
        session,
        patient_id=patient_id,
        owner_id=user.id if user.role == UserRole.PARENT else None,
        limit=limit,
        offset=offset,
    )

    return Page(
        items=[
            ConversationListItem(
                id=item.id,
                patient_id=item.patient_id,
                channel=str(item.channel),
                created_at=item.created_at,
                updated_at=item.updated_at,
                messages_count=len(item.messages or []),
                preview=_preview(item),
            )
            for item in items
        ],
        total=total,
    )


@router.get("/{conversation_id}", response_model=ConversationRead, summary="Один разговор")
async def read_conversation(
    patient_id: PatientIdPath,
    conversation_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: PatientAccessDep,
    after_seq: Annotated[int | None, Query(description="Только сообщения после этого")] = None,
) -> ConversationRead:
    conversation = await conversations_repo.get(session, conversation_id)

    # Одно сообщение на все случаи: чужой разговор не должен отличаться от
    # несуществующего — иначе по ответу устанавливается, что он есть.
    if conversation is None or conversation.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Разговор не найден.")

    if user.role == UserRole.PARENT and conversation.user_id != user.id:
        raise ApiError(ErrorCode.NOT_FOUND, "Разговор не найден.")

    if conversation.user_id != user.id:
        # Читает не автор — значит, специалист. След обязателен (правило 7).
        await audit_repo.write_audit_log(
            session,
            user_id=user.id,
            action="ai_conversation.read",
            entity="ai_conversations",
            entity_id=conversation.id,
        )

    messages = conversations_repo.messages_of(conversation)
    if after_seq is not None:
        messages = [message for message in messages if message.seq > after_seq]

    return ConversationRead(
        id=conversation.id,
        patient_id=conversation.patient_id,
        channel=str(conversation.channel),
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[MessageRead.model_validate(message.model_dump()) for message in messages],
    )


def _preview(conversation: object) -> str:
    messages = conversations_repo.messages_of(conversation)  # type: ignore[arg-type]
    for message in messages:
        if message.role == "user" and message.text:
            return message.text[:120]
    return ""
