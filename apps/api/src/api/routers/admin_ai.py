"""`/admin/ai` — providers, models, budgets and limits (ADR-0080, ADR-0082).

The administrator only: the role is checked on the router, so a new handle
cannot end up open through a forgotten dependency. Keys are write-only —
no response carries one, only its last four characters.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request

from core.ai_catalog import ModelEntry, ProviderSettings
from core.app_settings import AiGroup, GroupOverrides, ProjectOverrides
from core.config import get_settings
from core.models.enums import UserRole

from ..client_address import client_address
from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import limiter
from ..schemas_ai_settings import (
    AiKeyCheck,
    AiKeyCheckInput,
    AiKeyInput,
    AiPriceSuggestion,
    AiSettingsView,
    AiSpendReport,
    AssistantSpeedReport,
    SpendPeriod,
)
from ..services import ai_settings as service

router = APIRouter(
    prefix="/admin/ai",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)

ProviderId = Annotated[str, Path(pattern=r"^[a-z][a-z0-9-]{1,23}$")]

#: The check goes to the provider; a held-down button must not become a flood.
KEY_CHECK_RATE_LIMIT = "10/minute"


@router.get("", response_model=AiSettingsView, summary="Настройки ИИ и расход")
async def read_ai_settings(session: SessionDep) -> AiSettingsView:
    return await service.view(session, get_settings())


@router.get("/spend", response_model=AiSpendReport, summary="Кто сколько потратил на ИИ")
async def read_spend(
    session: SessionDep, period: Annotated[SpendPeriod, Query()] = "month"
) -> AiSpendReport:
    """Spend by group, kind, model and person (ADR-0081): a person and a sum,
    never what they asked."""

    return await service.spend_report(session, get_settings(), period)


@router.get(
    "/assistant-speed",
    response_model=AssistantSpeedReport,
    summary="Сколько идёт ответ помощника по шагам",
)
async def read_assistant_speed(
    session: SessionDep, period: Annotated[SpendPeriod, Query()] = "week"
) -> AssistantSpeedReport:
    """Step timings of assistant answers (ADR-0094): durations only, no text,
    no person, no child."""

    return await service.assistant_speed(session, get_settings(), period)


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
    settings = get_settings()
    await service.update_group(
        session, settings, actor=user, group=group, value=body, ip=client_address(request)
    )
    await session.commit()
    return await service.view(session, settings)


# --- providers (ADR-0082) --------------------------------------------------------


@router.post("/providers", response_model=AiSettingsView, summary="Добавить подключение")
async def create_provider(
    body: ProviderSettings, request: Request, user: CurrentUserDep, session: SessionDep
) -> AiSettingsView:
    await service.create_provider(
        session, get_settings(), actor=user, value=body, ip=client_address(request)
    )
    await session.commit()
    return await service.view(session, get_settings())


@router.put(
    "/providers/{provider_id}", response_model=AiSettingsView, summary="Изменить подключение"
)
async def update_provider(
    provider_id: ProviderId,
    body: ProviderSettings,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> AiSettingsView:
    settings = get_settings()
    await service.update_provider(
        session,
        settings,
        actor=user,
        provider_id=provider_id,
        value=body,
        ip=client_address(request),
    )
    await session.commit()
    return await service.view(session, settings)


@router.delete(
    "/providers/{provider_id}", response_model=AiSettingsView, summary="Убрать подключение"
)
async def remove_provider(
    provider_id: ProviderId, request: Request, user: CurrentUserDep, session: SessionDep
) -> AiSettingsView:
    """The connection goes together with its catalogue entries; refused while a
    group or a task runs on one of them."""

    settings = get_settings()
    await service.remove_provider(
        session, settings, actor=user, provider_id=provider_id, ip=client_address(request)
    )
    await session.commit()
    return await service.view(session, settings)


@router.put("/providers/{provider_id}/key", response_model=AiSettingsView, summary="Заменить ключ")
async def replace_key(
    provider_id: ProviderId,
    body: AiKeyInput,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> AiSettingsView:
    settings = get_settings()
    await service.replace_key(
        session,
        settings,
        actor=user,
        provider_id=provider_id,
        api_key=body.api_key,
        ip=client_address(request),
    )
    await session.commit()
    return await service.view(session, settings)


@router.delete(
    "/providers/{provider_id}/key",
    response_model=AiSettingsView,
    summary="Убрать ключ из кабинета",
)
async def remove_key(
    provider_id: ProviderId, request: Request, user: CurrentUserDep, session: SessionDep
) -> AiSettingsView:
    """The key typed in the cabinet is removed; for the built-in provider the
    environment one takes over."""

    settings = get_settings()
    if not await service.remove_key(
        session, settings, actor=user, provider_id=provider_id, ip=client_address(request)
    ):
        raise ApiError(ErrorCode.NOT_FOUND, "Ключ в кабинете не задан.")
    await session.commit()
    return await service.view(session, settings)


@router.post(
    "/providers/{provider_id}/check", response_model=AiKeyCheck, summary="Проверить подключение"
)
@limiter.limit(KEY_CHECK_RATE_LIMIT)
async def check_key(
    request: Request, provider_id: ProviderId, body: AiKeyCheckInput, session: SessionDep
) -> AiKeyCheck:
    """Asks the provider for its list of models: free, and says whether the key
    works and which models it may call. Writes nothing."""

    return await service.check_key(session, get_settings(), provider_id, body.api_key)


# --- the catalogue of models (ADR-0082) ---------------------------------------------


@router.put("/models", response_model=AiSettingsView, summary="Добавить или изменить модель")
async def save_model(
    body: ModelEntry, request: Request, user: CurrentUserDep, session: SessionDep
) -> AiSettingsView:
    settings = get_settings()
    await service.save_model(session, settings, actor=user, value=body, ip=client_address(request))
    await session.commit()
    return await service.view(session, settings)


@router.delete("/models", response_model=AiSettingsView, summary="Убрать модель из каталога")
async def remove_model(
    ref: Annotated[str, Query(min_length=1, max_length=160)],
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> AiSettingsView:
    """The reference travels in the query: model ids contain slashes."""

    settings = get_settings()
    await service.remove_model(session, settings, actor=user, ref=ref, ip=client_address(request))
    await session.commit()
    return await service.view(session, settings)


@router.get("/models/price", response_model=AiPriceSuggestion, summary="Известная цена модели")
async def price_suggestion(
    session: SessionDep,
    provider: Annotated[str, Query(min_length=2, max_length=24)],
    model: Annotated[str, Query(min_length=1, max_length=120)],
) -> AiPriceSuggestion:
    """A public price to prefill the form with — a hint, not what is charged."""

    return await service.price_suggestion(session, get_settings(), provider, model)
