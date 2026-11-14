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
from dataclasses import dataclass
from datetime import UTC, datetime
from datetime import time as dt_time
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import secret_box
from .ai_pricing import is_priced
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


def group_has_fast(group: AiGroup) -> bool:
    return any(task.speed == "fast" for task in AI_TASKS.values() if task.group is group)


# --- what the administrator may set ------------------------------------------

#: Upper bounds keep a typo ("1000" instead of "10.00") from opening the tap.
BUDGET_MAX_USD = 10000
USER_LIMIT_MAX = 1000

Budget = Decimal


def _priced_model(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    # A model without a price turns the budget off silently (`core.ai_pricing`).
    if not is_priced(value):
        raise ValueError(f"Модели «{value}» нет в прайс-листе — её расход не посчитать.")
    return value


class GroupOverrides(BaseModel):
    """A group's settings as stored. `None` — take the value from the environment."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    model: str | None = Field(default=None, max_length=128)
    model_fast: str | None = Field(default=None, max_length=128)
    daily_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    monthly_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    user_daily_limit: int | None = Field(default=None, ge=1, le=USER_LIMIT_MAX)

    _check_model = field_validator("model", "model_fast")(_priced_model)


class ProjectOverrides(BaseModel):
    model_config = ConfigDict(extra="forbid")

    daily_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)
    monthly_budget_usd: Decimal | None = Field(default=None, gt=0, le=BUDGET_MAX_USD)


KEY_API = "ai.api_key"
KEY_PROJECT = "ai.project"


def group_key(group: AiGroup) -> str:
    return f"ai.group.{group.value}"


# --- what the code reads ------------------------------------------------------

ValueSource = Literal["admin", "env"]


@dataclass(frozen=True)
class GroupConfig:
    group: AiGroup
    enabled: bool
    model: str
    model_fast: str
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    user_daily_limit: int

    def model_for(self, kind: AiJobKind) -> str:
        return self.model_fast if AI_TASKS[kind].speed == "fast" else self.model


@dataclass(frozen=True)
class AiConfig:
    api_key: str
    api_key_source: ValueSource | None
    daily_budget_usd: Decimal
    monthly_budget_usd: Decimal | None
    groups: dict[AiGroup, GroupConfig]

    def group_of(self, kind: AiJobKind) -> GroupConfig:
        return self.groups[AI_TASKS[kind].group]


@dataclass(frozen=True)
class StoredKey:
    """The key typed in the cabinet, as the cabinet may show it."""

    #: `None` — the row is there but cannot be read (encrypted under another key).
    value: str | None
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


def _group_overrides(rows: dict[str, _Row], group: AiGroup) -> GroupOverrides:
    row = rows.get(group_key(group))
    if row is None:
        return GroupOverrides()
    # A stored value that no longer validates (a model removed from the price
    # list) must not take AI down: the group falls back to the environment.
    try:
        return GroupOverrides.model_validate(row.value)
    except ValueError:
        return GroupOverrides(enabled=bool(row.value.get("enabled", True)))


def _project_overrides(rows: dict[str, _Row]) -> ProjectOverrides:
    row = rows.get(KEY_PROJECT)
    if row is None:
        return ProjectOverrides()
    try:
        return ProjectOverrides.model_validate(row.value)
    except ValueError:
        return ProjectOverrides()


def _stored_key(rows: dict[str, _Row], settings: Settings) -> StoredKey | None:
    row = rows.get(KEY_API)
    if row is None:
        return None
    token = row.value.get("ciphertext")
    value = secret_box.decrypt(settings, token) if isinstance(token, str) else None
    return StoredKey(
        value=value,
        hint=str(row.value.get("hint", "")),
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


async def stored_key(session: AsyncSession, settings: Settings) -> StoredKey | None:
    return _stored_key(await _rows(session), settings)


async def overrides(
    session: AsyncSession,
) -> tuple[ProjectOverrides, dict[AiGroup, GroupOverrides]]:
    rows = await _rows(session)
    return _project_overrides(rows), {group: _group_overrides(rows, group) for group in AiGroup}


async def ai_config(session: AsyncSession, settings: Settings) -> AiConfig:
    """Effective AI settings: the cabinet first, the environment as the fallback."""

    rows = await _rows(session)
    project = _project_overrides(rows)

    stored = _stored_key(rows, settings)
    if stored is not None and stored.value:
        api_key, source = stored.value, "admin"
    elif settings.anthropic_api_key:
        api_key, source = settings.anthropic_api_key, "env"
    else:
        api_key, source = "", None

    groups: dict[AiGroup, GroupConfig] = {}
    for group in AiGroup:
        own = _group_overrides(rows, group)
        groups[group] = GroupConfig(
            group=group,
            enabled=own.enabled,
            model=own.model or settings.ai_model_smart,
            model_fast=own.model_fast or settings.ai_model_fast,
            daily_budget_usd=own.daily_budget_usd,
            monthly_budget_usd=own.monthly_budget_usd,
            user_daily_limit=own.user_daily_limit or settings.ai_user_daily_limit,
        )

    return AiConfig(
        api_key=api_key,
        api_key_source=source,  # type: ignore[arg-type]
        daily_budget_usd=project.daily_budget_usd or Decimal(str(settings.ai_daily_budget_usd)),
        monthly_budget_usd=project.monthly_budget_usd,
        groups=groups,
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


async def save_group(
    session: AsyncSession, group: AiGroup, value: GroupOverrides, *, by: Any
) -> None:
    await _put(session, group_key(group), value.model_dump(mode="json"), by)


async def save_project(session: AsyncSession, value: ProjectOverrides, *, by: Any) -> None:
    await _put(session, KEY_PROJECT, value.model_dump(mode="json"), by)


async def save_key(session: AsyncSession, settings: Settings, api_key: str, *, by: Any) -> str:
    """Store the key encrypted; return the hint the cabinet will show."""

    shown = secret_box.hint(api_key)
    await _put(
        session,
        KEY_API,
        {"ciphertext": secret_box.encrypt(settings, api_key.strip()), "hint": shown},
        by,
    )
    return shown


async def remove_key(session: AsyncSession) -> bool:
    row = await session.get(AppSetting, KEY_API)
    if row is None:
        return False
    await session.delete(row)
    await session.flush()
    clear_cache()
    return True


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
