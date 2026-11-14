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


BudgetScope = Literal["project", "technical", "specialists", "families"]


class AiBudgetAlert(BaseModel):
    """A budget at 80 % or more of its period (ADR-0081)."""

    scope: BudgetScope
    period: Literal["day", "month"]
    level: Literal["warning", "exhausted"]
    percent: int
    spent_usd: Decimal
    budget_usd: Decimal


class AiSettingsView(BaseModel):
    key: AiKeyState
    project: AiProjectView
    groups: list[AiGroupView]
    models: list[AiModelOption]
    #: Budgets at 80 % or more — the fullest first.
    alerts: list[AiBudgetAlert]
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


# --- the spend report (ADR-0081) ------------------------------------------------

SpendPeriod = Literal["day", "week", "month"]


class AiSpendLine(BaseModel):
    """Calls and money of one cut. Failed calls cost money too and are counted."""

    calls: int
    failed_calls: int
    #: Calls whose cost is unknown — they broke off before an answer (network,
    #: timeout); a model without a price is never called. Not in `cost_usd`.
    unpriced_calls: int
    cost_usd: Decimal
    failed_cost_usd: Decimal
    tokens_in: int
    tokens_out: int


class AiGroupSpend(AiSpendLine):
    group: AiGroup


class AiKindSpend(AiSpendLine):
    kind: AiJobKind
    group: AiGroup


class AiModelSpend(AiSpendLine):
    model: str


class AiPersonSpend(BaseModel):
    """A person and their money — never what they asked: the administrator has
    no access to clinical data (section 5.1 of the TZ)."""

    user_id: str
    full_name: str
    role: str
    #: For the link to the account: the users list searches by e-mail or name.
    search: str
    is_active: bool
    calls: int
    failed_calls: int
    cost_usd: Decimal
    groups: list[AiGroup]


class AiSpendReport(BaseModel):
    period: SpendPeriod
    since: datetime
    totals: AiSpendLine
    by_group: list[AiGroupSpend]
    by_kind: list[AiKindSpend]
    by_model: list[AiModelSpend]
    #: The people who spent most, at most `people_limit` of them.
    people: list[AiPersonSpend]
    people_total: int
    people_limit: int
