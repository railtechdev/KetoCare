"""`/letterhead` — the clinic letterhead on every document (ADR-0092).

Reading is open to everyone signed in: documents are built by the server (PDF,
Excel) and by the cabinet (print, Word), for families and specialists alike,
and the letterhead is the clinic's public details, not patient data. Writing is
the administrator's, with an audit row per save.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from pydantic import BaseModel

from core import letterhead
from core.letterhead import LetterheadText, LogoError
from core.models.enums import UserRole
from core.repositories import audit as audit_repo

from ..client_address import client_address
from ..deps.auth import CurrentUser, CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode

router = APIRouter(prefix="/letterhead", tags=["letterhead"])
admin_router = APIRouter(
    prefix="/admin/letterhead",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)


class LogoRead(BaseModel):
    width: int
    height: int
    size: int
    #: Changes with the picture: the cabinet puts it into the logo address so a
    #: new logo is not hidden behind the browser's cache.
    sha256: str
    updated_at: datetime | None


class LetterheadRead(BaseModel):
    """`text` is empty until the administrator saves the letterhead; documents
    are then signed with `fallback_name`."""

    text: LetterheadText | None
    logo: LogoRead | None
    fallback_name: str
    updated_at: datetime | None


async def _view(session: SessionDep) -> LetterheadRead:
    stored = await letterhead.read(session)
    logo = (
        LogoRead(
            width=stored.logo.width,
            height=stored.logo.height,
            size=stored.logo.size,
            sha256=stored.logo.sha256,
            updated_at=stored.logo_updated_at,
        )
        if stored.logo is not None
        else None
    )
    return LetterheadRead(
        text=stored.text,
        logo=logo,
        fallback_name=letterhead.FALLBACK_NAME,
        updated_at=stored.text_updated_at,
    )


async def _audit(
    session: SessionDep,
    *,
    actor: CurrentUser,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    request: Request,
) -> None:
    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action=action,
        entity="app_settings",
        before=before,
        after=after,
        ip=client_address(request),
    )


def _logo_summary(info: letterhead.LogoInfo | None) -> dict[str, Any] | None:
    if info is None:
        return None
    return {
        "key": letterhead.KEY_LOGO,
        "width": info.width,
        "height": info.height,
        "sha256": info.sha256,
    }


@router.get("", response_model=LetterheadRead, summary="Бланк клиники")
async def read_letterhead(_user: CurrentUserDep, session: SessionDep) -> LetterheadRead:
    return await _view(session)


@router.get(
    "/logo",
    summary="Логотип клиники (PNG)",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, 404: {"description": "Логотип не задан"}},
)
async def read_logo(_user: CurrentUserDep, session: SessionDep) -> Response:
    logo = await letterhead.read_logo(session)
    if logo is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Логотип клиники не задан.")
    return Response(
        content=logo.data,
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=300",
            "ETag": f'"{logo.info.sha256}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@admin_router.put("", response_model=LetterheadRead, summary="Сохранить бланк клиники")
async def save_letterhead(
    body: LetterheadText, request: Request, user: CurrentUserDep, session: SessionDep
) -> LetterheadRead:
    before = (await letterhead.read(session)).text
    await letterhead.save_text(session, body, by=user.id)
    await _audit(
        session,
        actor=user,
        action="update",
        before={"key": letterhead.KEY_TEXT, **before.model_dump()} if before else None,
        after={"key": letterhead.KEY_TEXT, **body.model_dump()},
        request=request,
    )
    await session.commit()
    return await _view(session)


@admin_router.put("/logo", response_model=LetterheadRead, summary="Загрузить логотип клиники")
async def save_logo(
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
) -> LetterheadRead:
    """PNG only: the type is told by the file's signature, not by its name or
    `Content-Type`. SVG is refused — it can carry a script (ADR-0092)."""

    content = await file.read(letterhead.LOGO_MAX_BYTES + 1)
    before = (await letterhead.read(session)).logo
    try:
        info = await letterhead.save_logo(session, content, by=user.id)
    except LogoError as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from None
    await _audit(
        session,
        actor=user,
        action="update",
        before=_logo_summary(before),
        after=_logo_summary(info),
        request=request,
    )
    await session.commit()
    return await _view(session)


@admin_router.delete("/logo", response_model=LetterheadRead, summary="Убрать логотип клиники")
async def delete_logo(
    request: Request, user: CurrentUserDep, session: SessionDep
) -> LetterheadRead:
    before = (await letterhead.read(session)).logo
    if await letterhead.drop_logo(session):
        await _audit(
            session,
            actor=user,
            action="delete",
            before=_logo_summary(before),
            after=None,
            request=request,
        )
        await session.commit()
    return await _view(session)
