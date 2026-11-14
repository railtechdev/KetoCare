"""Schemas of `/admin/ai` — providers, models, budgets and limits (ADR-0080, ADR-0082)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.ai_catalog import ProviderKind
from core.app_settings import AiGroup
from core.models.enums import AiJobKind


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


class AiProviderKindOption(BaseModel):
    """A kind of provider the administrator may connect (ADR-0082)."""

    kind: ProviderKind
    needs_key: bool
    needs_base_url: bool
    default_base_url: str | None


class AiProviderView(BaseModel):
    id: str
    kind: ProviderKind
    name: str
    base_url: str | None
    enabled: bool
    #: Exists without a row and cannot be removed: the key typed before
    #: providers appeared, or `ANTHROPIC_API_KEY`.
    builtin: bool
    #: Calls may go out: switched on, has the key or address its kind needs, and
    #: the address is on the server's list of hosts.
    ready: bool
    host_allowed: bool
    key: AiKeyState
    models_count: int


class AiModelView(BaseModel):
    """A catalogue entry: a model that has a price and so may be chosen."""

    ref: str
    provider: str
    model: str
    name: str | None
    usd_per_mtok_in: Decimal
    usd_per_mtok_out: Decimal
    enabled: bool
    #: From the price list in the code.
    builtin: bool
    #: A built-in entry whose price or switch was changed in the cabinet.
    overridden: bool
    #: May be called right now: the entry and its provider are on, the key is set.
    usable: bool
    #: Chosen by a group or a task: cannot be removed.
    in_use: bool


class AiSpend(BaseModel):
    today_usd: Decimal
    month_usd: Decimal


class AiTaskView(BaseModel):
    kind: AiJobKind
    per_person: bool
    #: The model chosen for this task in the cabinet; `None` — not chosen.
    model: str | None
    #: The model the task runs on and where it came from.
    effective_model: str
    source: Literal["task", "group", "env"] | None
    usable: bool


class AiGroupView(BaseModel):
    group: AiGroup
    kinds: list[AiJobKind]
    #: Kinds counted against the per-person daily limit of calls.
    per_person_kinds: list[AiJobKind]
    enabled: bool
    #: Values set in the cabinet; `None` — the default applies.
    model: str | None
    tasks: list[AiTaskView]
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    user_daily_limit: int | None
    user_daily_budget_usd: Decimal | None
    default_user_daily_limit: int
    spend: AiSpend


class AiProjectView(BaseModel):
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    #: `AI_DAILY_BUDGET_USD` — the ceiling when no value is set in the cabinet.
    default_daily_budget_usd: Decimal
    warn_percent: int | None
    default_warn_percent: int
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
    providers: list[AiProviderView]
    provider_kinds: list[AiProviderKindOption]
    models: list[AiModelView]
    project: AiProjectView
    groups: list[AiGroupView]
    #: Budgets at the warning share or more — the fullest first.
    alerts: list[AiBudgetAlert]
    #: Where the encryption key of stored keys comes from.
    encryption: Literal["dedicated", "derived"]
    #: How long the worker may still run on the previous values.
    applies_within_s: int


class AiKeyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Keys differ by provider: eight characters is "not a typo", not a format.
    api_key: str = Field(min_length=8, max_length=400)

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


KeyProblem = Literal[
    "not_configured",
    "no_address",
    "host_not_allowed",
    "unauthorized",
    "forbidden",
    "unreachable",
    "unexpected",
]


class AiKeyCheck(BaseModel):
    ok: bool
    problem: KeyProblem | None
    #: Model ids the provider lists for this key — what may be added to the
    #: catalogue. Capped: a gateway may list thousands.
    models: list[str]
    #: Of them, already in the catalogue.
    in_catalog: list[str]


class AiPriceSuggestion(BaseModel):
    """A public price for a model being added — a hint for the form."""

    known: bool
    usd_per_mtok_in: Decimal | None
    usd_per_mtok_out: Decimal | None


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
