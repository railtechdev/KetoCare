"""Schemas of `/admin/ai` — AI key, models, budgets and limits (ADR-0080)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.app_settings import AiGroup
from core.models.enums import AiJobKind


class AiModelOption(BaseModel):
    """A model the budget can be counted for: it has a price."""

    id: str
    usd_per_mtok_in: Decimal
    usd_per_mtok_out: Decimal


class AiKeyState(BaseModel):
    configured: bool
    #: `admin` — typed in the cabinet; `env` — the environment fallback.
    source: Literal["admin", "env"] | None
    #: The last four characters of the key typed in the cabinet.
    hint: str | None
    #: The stored key cannot be decrypted (the encryption key changed): the
    #: environment fallback is used until the key is typed again.
    unreadable: bool
    updated_at: datetime | None
    updated_by_name: str | None
    #: Where the encryption key comes from: its own variable or SECRET_KEY.
    encryption: Literal["dedicated", "derived"]


class AiSpend(BaseModel):
    today_usd: Decimal
    month_usd: Decimal


class AiGroupDefaults(BaseModel):
    """What the group runs on when its field is empty — from the environment."""

    model: str
    model_fast: str | None
    user_daily_limit: int


class AiGroupView(BaseModel):
    group: AiGroup
    kinds: list[AiJobKind]
    #: Kinds counted against the per-person daily limit.
    per_person_kinds: list[AiJobKind]
    has_fast: bool
    enabled: bool
    #: Values set in the cabinet; `None` — the default below applies.
    model: str | None
    model_fast: str | None
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    user_daily_limit: int | None
    defaults: AiGroupDefaults
    spend: AiSpend


class AiProjectView(BaseModel):
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    #: `AI_DAILY_BUDGET_USD` — the ceiling when no value is set in the cabinet.
    default_daily_budget_usd: Decimal
    spend: AiSpend


class AiSettingsView(BaseModel):
    key: AiKeyState
    project: AiProjectView
    groups: list[AiGroupView]
    models: list[AiModelOption]
    #: How long the worker may still run on the previous values.
    applies_within_s: int


class AiKeyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str = Field(min_length=20, max_length=400)

    @field_validator("api_key")
    @classmethod
    def _one_token(cls, value: str) -> str:
        value = value.strip()
        if not value or any(char.isspace() for char in value):
            raise ValueError("Ключ — одна строка без пробелов.")
        return value


class AiKeyCheckInput(BaseModel):
    """`api_key` empty — check the key in effect now."""

    model_config = ConfigDict(extra="forbid")

    api_key: str | None = Field(default=None, max_length=400)


KeyProblem = Literal["not_configured", "unauthorized", "forbidden", "unreachable", "unexpected"]


class AiKeyCheck(BaseModel):
    ok: bool
    problem: KeyProblem | None
    #: Priced models this key can call.
    models: list[str]
