"""`/admin/ai` — the AI key, models, budgets and limits (ADR-0080).

The administrator only: the role is checked on the router, so a new handle
cannot end up open through a forgotten dependency. The key is write-only —
no response carries it, only its last four characters.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from core.app_settings import AiGroup, GroupOverrides, ProjectOverrides
from core.config import get_settings
from core.models.enums import UserRole

from ..client_address import client_address
from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import limiter
from ..schemas_ai_settings import AiKeyCheck, AiKeyCheckInput, AiKeyInput, AiSettingsView
from ..services import ai_settings as service

router = APIRouter(
    prefix="/admin/ai",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)

#: The check goes to the provider; a held-down button must not become a flood.
KEY_CHECK_RATE_LIMIT = "10/minute"


@router.get("", response_model=AiSettingsView, summary="Настройки ИИ и расход")
async def read_ai_settings(session: SessionDep) -> AiSettingsView:
    return await service.view(session, get_settings())


@router.put("/project", response_model=AiSettingsView, summary="Бюджет проекта")
async def update_project(
    body: ProjectOverrides, request: Request, user: CurrentUserDep, session: SessionDep
) -> AiSettingsView:
    await service.update_project(session, actor=user, value=body, ip=client_address(request))
    await session.commit()
    return await service.view(session, get_settings())


@router.put("/groups/{group}", response_model=AiSettingsView, summary="Группа задач ИИ")
async def update_group(
    group: AiGroup,
    body: GroupOverrides,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> AiSettingsView:
    await service.update_group(
        session, actor=user, group=group, value=body, ip=client_address(request)
    )
    await session.commit()
    return await service.view(session, get_settings())


@router.put("/key", response_model=AiSettingsView, summary="Заменить ключ ИИ")
async def replace_key(
    body: AiKeyInput, request: Request, user: CurrentUserDep, session: SessionDep
) -> AiSettingsView:
    settings = get_settings()
    await service.replace_key(
        session, settings, actor=user, api_key=body.api_key, ip=client_address(request)
    )
    await session.commit()
    return await service.view(session, settings)


@router.delete("/key", response_model=AiSettingsView, summary="Убрать ключ из кабинета")
async def remove_key(request: Request, user: CurrentUserDep, session: SessionDep) -> AiSettingsView:
    """The key typed in the cabinet is removed; the environment one takes over."""

    settings = get_settings()
    if not await service.remove_key(session, settings, actor=user, ip=client_address(request)):
        raise ApiError(ErrorCode.NOT_FOUND, "Ключ в кабинете не задан.")
    await session.commit()
    return await service.view(session, settings)


@router.post("/key/check", response_model=AiKeyCheck, summary="Проверить ключ ИИ")
@limiter.limit(KEY_CHECK_RATE_LIMIT)
async def check_key(request: Request, body: AiKeyCheckInput, session: SessionDep) -> AiKeyCheck:
    """Asks the provider for its list of models: free, and says whether the key
    works and which priced models it may call. Writes nothing."""

    return await service.check_key(session, get_settings(), body.api_key)
