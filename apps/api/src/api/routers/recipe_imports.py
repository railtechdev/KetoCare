"""`/recipe-imports` — recipes from the dietitian's own file, through a review table (ADR-0079).

The older `POST /recipes/import` takes a spreadsheet in our template and answers
with a list of errors. This one takes the file as it is and answers with a
draft: every recipe the file holds, every name the catalogue does not know,
every mass that could not be read — as rows the reviewer settles on one screen.
Nothing becomes a recipe until she accepts it.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status

from core import recipe_import as shape
from core.models import RecipeImportDraft
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import recipe_import_drafts as drafts_repo

from .. import after_commit
from ..client_address import client_address
from ..deps.auth import CurrentUser, CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import IMPORT_RATE_LIMIT, limiter
from ..schemas_recipe_import import (
    CommitRequest,
    CommitResult,
    NameDecision,
    RecipeEdit,
    RecipeImportSummary,
    RecipeImportView,
)
from ..services import recipe_drafts, recipe_file, uploads

# The same circle as recipe editing (ADR-0063).
_EDITOR_ROLES = (UserRole.ADMIN, UserRole.DIETITIAN, UserRole.DOCTOR)

router = APIRouter(
    prefix="/recipe-imports",
    tags=["recipes"],
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)

#: Pasted text is bounded like an uploaded file.
_MAX_TEXT_CHARS = recipe_file.MAX_CHARS * 2


async def _own_draft(
    session: SessionDep, draft_id: uuid.UUID, user: CurrentUser, *, for_update: bool = False
) -> RecipeImportDraft:
    """The reviewer's own draft. Somebody else's is "not found", not "forbidden":
    a draft is a private workbench, and its existence is nobody else's business."""

    draft = await drafts_repo.get(session, draft_id, for_update=for_update)
    if draft is None or draft.created_by != user.id:
        raise ApiError(ErrorCode.NOT_FOUND, "Загрузка не найдена.")
    return draft


@router.post(
    "",
    response_model=RecipeImportSummary,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Загрузить файл с рецептами на разбор",
)
@limiter.limit(IMPORT_RATE_LIMIT)
async def start_import(
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
    file: Annotated[UploadFile | None, File()] = None,
    text: Annotated[str | None, Form(max_length=_MAX_TEXT_CHARS)] = None,
) -> RecipeImportSummary:
    """Take the file as it is and start reading it.

    Answers 202: the file is read in the background, part by part, and the
    draft is polled. A format that cannot be read is refused with a way out in
    the message — save as .docx, paste the text.
    """

    try:
        if file is not None:
            lines = recipe_file.extract_lines(await uploads.read_within_limit(file))
            name = (file.filename or "").strip() or "Файл"
        elif text is not None and text.strip():
            lines = recipe_file.lines_of_text(text)
            name = "Вставленный текст"
        else:
            raise ApiError(ErrorCode.VALIDATION_ERROR, "Выберите файл или вставьте текст.")
    except recipe_file.UnreadableFile as error:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(error)) from error

    draft = await drafts_repo.create(
        session,
        created_by=user.id,
        file_name=name[:255],
        source_lines=lines,
        payload=shape.new_payload(),
    )
    after_commit.defer(session, "parse_recipe_file", str(draft.id))
    await session.commit()
    await session.refresh(draft)
    return recipe_drafts.summary(draft)


@router.get("", response_model=list[RecipeImportSummary], summary="Мои незаконченные загрузки")
async def list_imports(user: CurrentUserDep, session: SessionDep) -> list[RecipeImportSummary]:
    drafts = await drafts_repo.list_open(session, created_by=user.id)
    return [recipe_drafts.summary(draft) for draft in drafts]


@router.get("/{draft_id}", response_model=RecipeImportView, summary="Загрузка на проверке")
async def get_import(
    draft_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> RecipeImportView:
    draft = await _own_draft(session, draft_id, user)
    return await recipe_drafts.view(session, draft)


@router.post(
    "/{draft_id}/resume",
    response_model=RecipeImportView,
    summary="Продолжить разбор файла",
)
async def resume_import(
    draft_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> RecipeImportView:
    """Pick the reading up where it stopped: after a refusal or a lost task.

    Starting it twice is harmless — a part is written only by the run that
    finds the draft where it left it.
    """

    draft = await _own_draft(session, draft_id, user, for_update=True)
    if draft.lines_done >= len(draft.source_lines):
        raise ApiError(ErrorCode.CONFLICT, "Файл уже разобран целиком.")
    draft.status = drafts_repo.PARSING
    draft.failure = None
    after_commit.defer(session, "parse_recipe_file", str(draft.id))
    await session.commit()
    await session.refresh(draft)
    return await recipe_drafts.view(session, draft)


@router.put(
    "/{draft_id}/names",
    response_model=RecipeImportView,
    summary="Решение по названию продукта из файла",
)
async def decide_name(
    draft_id: uuid.UUID,
    decision: NameDecision,
    user: CurrentUserDep,
    session: SessionDep,
) -> RecipeImportView:
    """Match a name to a product, leave it out of the calculation, or withdraw
    the decision. One decision settles the name in every recipe of the file."""

    draft = await _own_draft(session, draft_id, user, for_update=True)
    await recipe_drafts.decide_name(session, draft=draft, decision=decision, user_id=user.id)
    await session.commit()
    await session.refresh(draft)
    return await recipe_drafts.view(session, draft)


@router.patch(
    "/{draft_id}/recipes/{recipe_id}",
    response_model=RecipeImportView,
    summary="Правка рецепта на проверке",
)
async def edit_recipe(
    draft_id: uuid.UUID,
    recipe_id: str,
    edit: RecipeEdit,
    user: CurrentUserDep,
    session: SessionDep,
) -> RecipeImportView:
    draft = await _own_draft(session, draft_id, user, for_update=True)
    recipe_drafts.edit_recipe(draft, recipe_id, edit)
    await session.commit()
    await session.refresh(draft)
    return await recipe_drafts.view(session, draft)


@router.post(
    "/{draft_id}/commit",
    response_model=CommitResult,
    summary="Загрузить готовые рецепты",
)
async def commit_import(
    request: Request,
    draft_id: uuid.UUID,
    payload: CommitRequest,
    user: CurrentUserDep,
    session: SessionDep,
) -> CommitResult:
    """Create recipes from the ready rows; the rest stay in the draft.

    Recipes are created as drafts of the library: publishing is a separate
    decision (section 5.3). Existing recipes are never overwritten — a row
    whose title is taken is not ready, and the table says so.
    """

    draft = await _own_draft(session, draft_id, user, for_update=True)
    created = await recipe_drafts.commit(
        session, draft=draft, recipe_ids=payload.recipe_ids, user_id=user.id
    )
    for item in created:
        await audit_repo.write_audit_log(
            session,
            user_id=user.id,
            action="import",
            entity="recipes",
            entity_id=item.recipe_id,
            before=None,
            after={"title": item.title, "file": draft.file_name},
            ip=client_address(request),
        )
    await session.commit()
    await session.refresh(draft)
    return CommitResult(imported=len(created), draft=await recipe_drafts.view(session, draft))


@router.delete(
    "/{draft_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Убрать загрузку",
)
async def close_import(draft_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> Response:
    """Remove the draft from the reviewer's list. Recipes already created stay."""

    draft = await _own_draft(session, draft_id, user, for_update=True)
    await drafts_repo.close(session, draft=draft)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
