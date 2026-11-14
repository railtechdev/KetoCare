"""Settings the administrator changes in the cabinet, and how they are read (ADR-0080).

Today the registry holds the AI part: the provider key, and per group of tasks a
model, budgets, a per-person limit and a switch. Every value has a fallback in
the environment (`core.config.Settings`), so an empty `app_settings` table means
the stand behaves exactly as before the table existed.

Rows are read by the API and by the worker with a short cache (`CACHE_TTL_S`):
a change in the cabinet reaches the worker within that time, without a restart.

**Groups of tasks.** The owner asked to choose models and limits "for technical
work, for specialists, for families". Every kind of AI job belongs to exactly
one group; a group's budget is its own and is not borrowed by another one — a
dietitian reading a three-thousand-line collection no longer leaves the family
assistant silent until tomorrow. The project budget stays the ceiling over all.
"""

from __future__ import annotations

import enum
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from datetime import time as dt_time
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import secret_box
from .ai_catalog import (
    BUILTIN_PROVIDER,
    Catalog,
    ModelEntry,
    Provider,
    ProviderKind,
    ProviderSettings,
    is_provider_id,
    merge_models,
)
from .config import Settings
from .models import AppSetting
from .models.enums import AiJobKind


class AiGroup(enum.StrEnum):
    TECHNICAL = "technical"
    SPECIALISTS = "specialists"
    FAMILIES = "families"


Speed = Literal["fast", "smart"]


@dataclass(frozen=True)
class AiTask:
    group: AiGroup
    #: Fast tasks are waited for synchronously (`POST /ai/parse`, 15 s) and take
    #: the group's fast model; the rest take its main model.
    speed: Speed
    #: Counted against the per-person daily limit of the group. Meal parsing is
    #: not: a parent parses as often as the child eats. Reading a recipe file is
    #: not either: one collection is dozens of calls.
    per_person: bool


AI_TASKS: dict[AiJobKind, AiTask] = {
    AiJobKind.ASSISTANT: AiTask(AiGroup.FAMILIES, "smart", per_person=True),
    AiJobKind.PARSE_MEAL: AiTask(AiGroup.FAMILIES, "fast", per_person=False),
    AiJobKind.PARSE_EVENT: AiTask(AiGroup.FAMILIES, "fast", per_person=False),
    AiJobKind.DOCTOR_SUMMARY: AiTask(AiGroup.SPECIALISTS, "smart", per_person=True),
    AiJobKind.CONTENT_DRAFT: AiTask(AiGroup.TECHNICAL, "smart", per_person=True),
    AiJobKind.RECIPE_IMPORT: AiTask(AiGroup.TECHNICAL, "smart", per_person=False),
}


def kinds_of(group: AiGroup) -> list[AiJobKind]:
    return [kind for kind, task in AI_TASKS.items() if task.group is group]


# --- what the administrator may set ------------------------------------------

#: Upper bounds keep a typo ("1000" instead of "10.00") from opening the tap.
BUDGET_MAX_USD = 10000
USER_LIMIT_MAX = 1000

Budget = Decimal


def _model_ref(value: str | None) -> str | None:
    """A reference is trimmed here and checked against the catalogue by the
    caller: whether a model exists is data now, not something a schema knows."""

    value = (value or "").strip()
    return value or None


class GroupOverrides(BaseModel):
    """A group's settings as stored. `None` — take the value from the environment."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    #: The group's model: every task of the group without its own one takes it.
    model: str | None = Field(default=None, max_length=160)
    #: A model for one task of the group (ADR-0082). Before it a group had one
    #: model plus a "fast" one, which only the families group could set.
    task_models: dict[AiJobKind, str] = Field(default_factory=dict)
    daily_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    monthly_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    user_daily_limit: int | None = Field(default=None, ge=1, le=USER_LIMIT_MAX)
    #: Money one person may spend in the group per day — every task counts,
    #: including the ones the call limit skips (reading a recipe file).
    user_daily_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)

    _check_model = field_validator("model")(_model_ref)

    @model_validator(mode="before")
    @classmethod
    def _legacy_fast_model(cls, data: Any) -> Any:
        """Rows written before ADR-0082 carry `model_fast`: it becomes the model
        of the fast tasks."""

        if not isinstance(data, dict) or "model_fast" not in data:
            return data
        data = dict(data)
        fast = data.pop("model_fast")
        if isinstance(fast, str) and fast.strip() and not data.get("task_models"):
            data["task_models"] = {
                kind.value: fast.strip() for kind, task in AI_TASKS.items() if task.speed == "fast"
            }
        return data

    @field_validator("task_models")
    @classmethod
    def _drop_blank(cls, value: dict[AiJobKind, str]) -> dict[AiJobKind, str]:
        return {kind: ref.strip() for kind, ref in value.items() if ref and ref.strip()}


#: The share of a budget at which the administrator is warned, in percent.
WARN_PERCENT_DEFAULT = 80


class ProjectOverrides(BaseModel):
    model_config = ConfigDict(extra="forbid")

    daily_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    monthly_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    #: When to warn about a filling budget; empty — at 80 %.
    warn_percent: int | None = Field(default=None, ge=50, le=99)


#: The key of the built-in provider — where it was stored before providers
#: existed (ADR-0080). Kept: a key typed then must still be the one used.
KEY_API = "ai.api_key"
KEY_PROJECT = "ai.project"
KEY_MODELS = "ai.models"
_PROVIDER_PREFIX = "ai.provider."


def group_key(group: AiGroup) -> str:
    return f"ai.group.{group.value}"


def provider_key(provider_id: str) -> str:
    return KEY_API if provider_id == BUILTIN_PROVIDER else f"{_PROVIDER_PREFIX}{provider_id}"


# --- what the code reads ------------------------------------------------------

ValueSource = Literal["admin", "env"]


@dataclass(frozen=True)
class GroupConfig:
    group: AiGroup
    enabled: bool
    #: The model reference each task of the group runs on; empty — none is set.
    task_models: dict[AiJobKind, str]
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    user_daily_limit: int
    user_daily_budget_usd: Decimal | None

    def model_for(self, kind: AiJobKind) -> str:
        return self.task_models.get(kind, "")


@dataclass(frozen=True)
class AiConfig:
    #: The built-in provider's key. Out of `repr`: error reporters print local
    #: variables of a failing frame.
    api_key: str = field(repr=False)
    api_key_source: ValueSource | None
    daily_budget_usd: Decimal
    monthly_budget_usd: Decimal | None
    warn_share: Decimal
    groups: dict[AiGroup, GroupConfig]
    catalog: Catalog

    def group_of(self, kind: AiJobKind) -> GroupConfig:
        return self.groups[AI_TASKS[kind].group]


@dataclass(frozen=True)
class StoredKey:
    """A key typed in the cabinet, as the cabinet may show it."""

    #: `None` — the row is there but cannot be read (encrypted under another key,
    #: or the encryption key in the environment is malformed). Out of `repr`.
    value: str | None = field(repr=False)
    hint: str
    updated_at: Any
    updated_by: Any


# --- reading ------------------------------------------------------------------

#: How long a process trusts what it read. The API drops its copy on every
#: change it makes; the worker sees a change from the cabinet within this time.
CACHE_TTL_S = 30.0


@dataclass(frozen=True)
class _Row:
    value: dict[str, Any]
    updated_at: Any
    updated_by: Any


_cache: tuple[float, dict[str, _Row]] | None = None


def clear_cache() -> None:
    global _cache
    _cache = None


async def _rows(session: AsyncSession) -> dict[str, _Row]:
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < CACHE_TTL_S:
        return _cache[1]
    rows = {
        row.key: _Row(value=dict(row.value), updated_at=row.updated_at, updated_by=row.updated_by)
        for row in await session.scalars(select(AppSetting))
    }
    _cache = (now, rows)
    return rows


def _field_by_field[T: BaseModel](model: type[T], value: dict[str, Any]) -> T:
    """A stored value that no longer validates as a whole, read field by field.

    One field that stopped validating must not drop the group's budgets and
    limit with it — that would silently take the ceiling off. Only the fields
    that fail fall back to their defaults (the environment).
    """

    try:
        return model.model_validate(value)
    except ValueError:
        pass
    kept: dict[str, Any] = {}
    for name, field_value in value.items():
        try:
            model.model_validate({name: field_value})
        except ValueError:
            continue
        kept[name] = field_value
    return model.model_validate(kept)


def _group_overrides(rows: dict[str, _Row], group: AiGroup) -> GroupOverrides:
    row = rows.get(group_key(group))
    if row is None:
        return GroupOverrides()
    return _field_by_field(GroupOverrides, row.value)


def _project_overrides(rows: dict[str, _Row]) -> ProjectOverrides:
    row = rows.get(KEY_PROJECT)
    if row is None:
        return ProjectOverrides()
    return _field_by_field(ProjectOverrides, row.value)


def _stored_key(rows: dict[str, _Row], settings: Settings, provider_id: str) -> StoredKey | None:
    row = rows.get(provider_key(provider_id))
    if row is None:
        return None
    token = row.value.get("ciphertext")
    if not isinstance(token, str):
        # A provider row without a key: the connection exists, the key does not.
        return None
    try:
        value = secret_box.decrypt(settings, token)
    except secret_box.BadEncryptionKey:
        # A malformed SETTINGS_ENCRYPTION_KEY must not take AI and the admin
        # screen down: the key reads as unreadable and the environment works on.
        value = None
    return StoredKey(
        value=value,
        hint=str(row.value.get("hint", "")),
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


async def stored_key(
    session: AsyncSession, settings: Settings, provider_id: str = BUILTIN_PROVIDER
) -> StoredKey | None:
    return _stored_key(await _rows(session), settings, provider_id)


def _providers(rows: dict[str, _Row], settings: Settings) -> dict[str, Provider]:
    stored = _stored_key(rows, settings, BUILTIN_PROVIDER)
    if stored is not None and stored.value:
        api_key, source = stored.value, "admin"
    elif settings.anthropic_api_key:
        api_key, source = settings.anthropic_api_key, "env"
    else:
        api_key, source = "", None

    providers: dict[str, Provider] = {
        BUILTIN_PROVIDER: Provider(
            id=BUILTIN_PROVIDER,
            kind=ProviderKind.ANTHROPIC,
            name="Anthropic",
            base_url=None,
            enabled=True,
            api_key=api_key,
            key_source=source,  # type: ignore[arg-type]
            builtin=True,
        )
    }
    for key, row in sorted(rows.items()):
        if not key.startswith(_PROVIDER_PREFIX):
            continue
        provider_id = key.removeprefix(_PROVIDER_PREFIX)
        try:
            own = ProviderSettings.model_validate(
                {name: row.value.get(name) for name in ("kind", "name", "base_url", "enabled")}
            )
        except ValueError:
            # One bad row must not take every AI function down.
            continue
        typed = _stored_key(rows, settings, provider_id)
        providers[provider_id] = Provider(
            id=provider_id,
            kind=own.kind,
            name=own.name,
            base_url=own.base_url,
            enabled=own.enabled,
            api_key=(typed.value or "") if typed is not None else "",
            key_source="admin" if typed is not None and typed.value else None,
            builtin=False,
        )
    return providers


def _stored_models(rows: dict[str, _Row]) -> list[dict[str, Any]]:
    row = rows.get(KEY_MODELS)
    items = row.value.get("items") if row is not None else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _catalog(rows: dict[str, _Row], settings: Settings) -> Catalog:
    providers = _providers(rows, settings)
    return Catalog(providers=providers, models=merge_models(_stored_models(rows), providers))


async def catalog(session: AsyncSession, settings: Settings) -> Catalog:
    return _catalog(await _rows(session), settings)


async def stored_models(session: AsyncSession) -> list[ModelEntry]:
    """Catalogue entries the administrator wrote — without the built-in ones."""

    entries = []
    for raw in _stored_models(await _rows(session)):
        try:
            entries.append(ModelEntry.model_validate(raw))
        except ValueError:
            continue
    return entries


async def overrides(
    session: AsyncSession,
) -> tuple[ProjectOverrides, dict[AiGroup, GroupOverrides]]:
    rows = await _rows(session)
    return _project_overrides(rows), {group: _group_overrides(rows, group) for group in AiGroup}


def task_model_candidates(
    kind: AiJobKind, own: GroupOverrides, settings: Settings
) -> list[tuple[str, Literal["task", "group", "env"]]]:
    """Where a task's model may come from, the most specific first.

    A fast task without its own model takes the environment's fast one before
    the group's: it is waited for synchronously (`POST /ai/parse`, 15 s), and a
    group moved to a large model must not move it there by accident.
    """

    found: list[tuple[str, Literal["task", "group", "env"]]] = []
    if own.task_models.get(kind):
        found.append((own.task_models[kind], "task"))
    if AI_TASKS[kind].speed == "fast" and settings.ai_model_fast:
        found.append((settings.ai_model_fast, "env"))
    if own.model:
        found.append((own.model, "group"))
    if settings.ai_model_smart:
        found.append((settings.ai_model_smart, "env"))
    return found


def effective_task_model(
    kind: AiJobKind, own: GroupOverrides, settings: Settings, models: Catalog
) -> tuple[str, Literal["task", "group", "env"] | None]:
    """The model a task runs on and where it came from.

    The first candidate that can be called wins: a model whose provider lost
    its key, or that left the catalogue, does not take the task down while a
    less specific one works. If none can be called, the most specific is
    returned so the refusal names what the administrator chose.
    """

    candidates = task_model_candidates(kind, own, settings)
    for ref, source in candidates:
        if models.usable(ref):
            return ref, source
    return candidates[0] if candidates else ("", None)


async def ai_config(session: AsyncSession, settings: Settings) -> AiConfig:
    """Effective AI settings: the cabinet first, the environment as the fallback."""

    rows = await _rows(session)
    project = _project_overrides(rows)
    models = _catalog(rows, settings)
    builtin = models.providers[BUILTIN_PROVIDER]

    groups: dict[AiGroup, GroupConfig] = {}
    for group in AiGroup:
        own = _group_overrides(rows, group)
        groups[group] = GroupConfig(
            group=group,
            enabled=own.enabled,
            task_models={
                kind: effective_task_model(kind, own, settings, models)[0]
                for kind in kinds_of(group)
            },
            daily_budget_usd=own.daily_budget_usd,
            monthly_budget_usd=own.monthly_budget_usd,
            user_daily_limit=own.user_daily_limit or settings.ai_user_daily_limit,
            user_daily_budget_usd=own.user_daily_budget_usd,
        )

    return AiConfig(
        api_key=builtin.api_key,
        api_key_source=builtin.key_source,
        daily_budget_usd=project.daily_budget_usd or Decimal(str(settings.ai_daily_budget_usd)),
        monthly_budget_usd=project.monthly_budget_usd,
        warn_share=Decimal(project.warn_percent or WARN_PERCENT_DEFAULT) / 100,
        groups=groups,
        catalog=models,
    )


# --- writing ------------------------------------------------------------------


async def _put(session: AsyncSession, key: str, value: dict[str, Any], by: Any) -> None:
    row = await session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=value, updated_by=by))
    else:
        row.value = value
        row.updated_by = by
    await session.flush()
    clear_cache()


async def _drop(session: AsyncSession, key: str) -> bool:
    row = await session.get(AppSetting, key)
    if row is None:
        return False
    await session.delete(row)
    await session.flush()
    clear_cache()
    return True


async def save_group(
    session: AsyncSession, group: AiGroup, value: GroupOverrides, *, by: Any
) -> None:
    await _put(session, group_key(group), value.model_dump(mode="json"), by)


async def save_project(session: AsyncSession, value: ProjectOverrides, *, by: Any) -> None:
    await _put(session, KEY_PROJECT, value.model_dump(mode="json"), by)


async def new_provider_id(session: AsyncSession, kind: ProviderKind) -> str:
    """An id for a new connection: the kind, then `kind-2`, `kind-3`…"""

    taken = {
        BUILTIN_PROVIDER,
        *(
            key.removeprefix(_PROVIDER_PREFIX)
            for key in await _rows(session)
            if key.startswith(_PROVIDER_PREFIX)
        ),
    }
    base = kind.value.replace("_", "-")[:20]
    number = 1
    while True:
        candidate = base if number == 1 else f"{base}-{number}"
        if candidate not in taken:
            return candidate
        number += 1


async def save_provider(
    session: AsyncSession, provider_id: str, value: ProviderSettings, *, by: Any
) -> None:
    """Write a connection's settings, keeping the key it already has."""

    if provider_id == BUILTIN_PROVIDER or not is_provider_id(provider_id):
        raise ValueError(f"Not a provider that can be stored: {provider_id!r}")
    row = await session.get(AppSetting, provider_key(provider_id))
    kept: dict[str, Any] = {
        name: row.value[name] for name in ("ciphertext", "hint") if row and name in row.value
    }
    await _put(session, provider_key(provider_id), {**value.model_dump(mode="json"), **kept}, by)


async def remove_provider(session: AsyncSession, provider_id: str) -> bool:
    if provider_id == BUILTIN_PROVIDER:
        return False
    return await _drop(session, provider_key(provider_id))


async def save_key(
    session: AsyncSession,
    settings: Settings,
    api_key: str,
    *,
    by: Any,
    provider_id: str = BUILTIN_PROVIDER,
) -> str:
    """Store a provider's key encrypted; return the hint the cabinet will show."""

    shown = secret_box.hint(api_key)
    secret = {"ciphertext": secret_box.encrypt(settings, api_key.strip()), "hint": shown}
    if provider_id == BUILTIN_PROVIDER:
        await _put(session, KEY_API, secret, by)
        return shown
    row = await session.get(AppSetting, provider_key(provider_id))
    if row is None:
        raise LookupError(provider_id)
    await _put(session, provider_key(provider_id), {**row.value, **secret}, by)
    return shown


async def remove_key(session: AsyncSession, provider_id: str = BUILTIN_PROVIDER) -> bool:
    if provider_id == BUILTIN_PROVIDER:
        return await _drop(session, KEY_API)
    row = await session.get(AppSetting, provider_key(provider_id))
    if row is None or "ciphertext" not in row.value:
        return False
    value = {name: item for name, item in row.value.items() if name not in ("ciphertext", "hint")}
    await _put(session, provider_key(provider_id), value, row.updated_by)
    return True


async def save_models(session: AsyncSession, entries: list[ModelEntry], *, by: Any) -> None:
    """Replace the administrator's part of the catalogue."""

    await _put(
        session, KEY_MODELS, {"items": [entry.model_dump(mode="json") for entry in entries]}, by
    )


# --- periods ------------------------------------------------------------------


def day_start(tz: str, now: datetime | None = None) -> datetime:
    """Local midnight of today, in UTC: budgets and limits are "for today" as
    the family understands it, not since midnight UTC."""

    zone = ZoneInfo(tz)
    local = (now or datetime.now(UTC)).astimezone(zone)
    return datetime.combine(local.date(), dt_time.min, tzinfo=zone).astimezone(UTC)


def month_start(tz: str, now: datetime | None = None) -> datetime:
    zone = ZoneInfo(tz)
    local = (now or datetime.now(UTC)).astimezone(zone)
    first = local.date().replace(day=1)
    return datetime.combine(first, dt_time.min, tzinfo=zone).astimezone(UTC)


def week_start(tz: str, now: datetime | None = None) -> datetime:
    """Local midnight six days ago: "this week" on the spend screen is the last
    seven calendar days including today, not the week since Monday — on a
    Monday morning the latter would show almost nothing."""

    zone = ZoneInfo(tz)
    local = (now or datetime.now(UTC)).astimezone(zone)
    first = local.date() - timedelta(days=6)
    return datetime.combine(first, dt_time.min, tzinfo=zone).astimezone(UTC)
