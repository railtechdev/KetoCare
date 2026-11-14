"""The «ИИ» section of the admin area: key, models, budgets, limits (ADR-0080)
and who spent what (ADR-0081).

Spend is shown by group, kind, model and person. The administrator has no
access to clinical data (section 5.1 of the TZ): nothing in this section reads
a request text or names a child — a person and a sum, never what they asked.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from core import ai_budget, app_settings, secret_box
from core.ai_pricing import PRICES_USD_PER_MTOK, is_priced
from core.app_settings import AI_TASKS, AiGroup, GroupOverrides, ProjectOverrides
from core.config import Settings
from core.models.enums import AiJobKind, AiJobStatus
from core.repositories import ai_jobs as ai_jobs_repo
from core.repositories import audit as audit_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUser
from ..errors import ApiError, ErrorCode
from ..schemas_ai_settings import (
    AiBudgetAlert,
    AiGroupDefaults,
    AiGroupSpend,
    AiGroupView,
    AiKeyCheck,
    AiKeyState,
    AiKindSpend,
    AiModelOption,
    AiModelSpend,
    AiPersonSpend,
    AiProjectView,
    AiSettingsView,
    AiSpend,
    AiSpendLine,
    AiSpendReport,
    SpendPeriod,
)

#: The provider's list of models: free, needs only the key, and is the
#: cheapest honest answer to "does this key work" (ADR-0080).
ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
ANTHROPIC_VERSION = "2023-06-01"
CHECK_TIMEOUT_S = 10.0


async def fetch_model_ids(api_key: str) -> tuple[int, list[str]]:
    """HTTP status of the provider and the model ids the key may call.

    Replaced in tests: the suite never goes to the network.
    """

    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT_S) as client:
        response = await client.get(
            ANTHROPIC_MODELS_URL,
            params={"limit": 1000},
            headers={"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION},
        )
    if response.status_code != 200:
        return response.status_code, []
    data = response.json().get("data", [])
    return 200, [str(item["id"]) for item in data if isinstance(item, dict) and "id" in item]


async def check_key(session: AsyncSession, settings: Settings, api_key: str | None) -> AiKeyCheck:
    key = (api_key or "").strip()
    if not key:
        key = (await app_settings.ai_config(session, settings)).api_key
    if not key:
        return AiKeyCheck(ok=False, problem="not_configured", models=[])
    try:
        status, ids = await fetch_model_ids(key)
    except (httpx.HTTPError, ValueError):
        return AiKeyCheck(ok=False, problem="unreachable", models=[])
    if status == 200:
        return AiKeyCheck(ok=True, problem=None, models=sorted({m for m in ids if is_priced(m)}))
    if status == 401:
        return AiKeyCheck(ok=False, problem="unauthorized", models=[])
    if status == 403:
        return AiKeyCheck(ok=False, problem="forbidden", models=[])
    return AiKeyCheck(ok=False, problem="unexpected", models=[])


def _spend_of(totals: dict[AiJobKind, Decimal], kinds: list[AiJobKind] | None) -> Decimal:
    if kinds is None:
        return sum(totals.values(), Decimal(0))
    return sum((totals.get(kind, Decimal(0)) for kind in kinds), Decimal(0))


async def view(session: AsyncSession, settings: Settings) -> AiSettingsView:
    # The administrator sees what is stored, not this process's copy: the API
    # may run in several processes, and another one may have just saved.
    app_settings.clear_cache()
    project, groups = await app_settings.overrides(session)
    stored = await app_settings.stored_key(session, settings)
    config = await app_settings.ai_config(session, settings)

    today = await ai_jobs_repo.cost_by_kind_since(
        session, since=app_settings.day_start(settings.tz)
    )
    month = await ai_jobs_repo.cost_by_kind_since(
        session, since=app_settings.month_start(settings.tz)
    )

    updated_by_name: str | None = None
    if stored is not None and stored.updated_by is not None:
        author = await users_repo.get(session, stored.updated_by)
        updated_by_name = author.full_name if author is not None else None

    group_views = []
    for group in AiGroup:
        own = groups[group]
        kinds = app_settings.kinds_of(group)
        has_fast = app_settings.group_has_fast(group)
        group_views.append(
            AiGroupView(
                group=group,
                kinds=kinds,
                per_person_kinds=[kind for kind in kinds if AI_TASKS[kind].per_person],
                has_fast=has_fast,
                enabled=own.enabled,
                model=own.model,
                model_fast=own.model_fast if has_fast else None,
                daily_budget_usd=own.daily_budget_usd,
                monthly_budget_usd=own.monthly_budget_usd,
                user_daily_limit=own.user_daily_limit,
                defaults=AiGroupDefaults(
                    model=settings.ai_model_smart,
                    model_fast=settings.ai_model_fast if has_fast else None,
                    user_daily_limit=settings.ai_user_daily_limit,
                ),
                spend=AiSpend(today_usd=_spend_of(today, kinds), month_usd=_spend_of(month, kinds)),
            )
        )

    return AiSettingsView(
        key=AiKeyState(
            configured=bool(config.api_key),
            source=config.api_key_source,
            hint=stored.hint if stored is not None else None,
            unreadable=stored is not None and stored.value is None,
            updated_at=stored.updated_at if stored is not None else None,
            updated_by_name=updated_by_name,
            encryption=secret_box.key_source(settings),
        ),
        project=AiProjectView(
            daily_budget_usd=project.daily_budget_usd,
            monthly_budget_usd=project.monthly_budget_usd,
            default_daily_budget_usd=Decimal(str(settings.ai_daily_budget_usd)),
            spend=AiSpend(today_usd=_spend_of(today, None), month_usd=_spend_of(month, None)),
        ),
        groups=group_views,
        models=[
            AiModelOption(id=model, usd_per_mtok_in=price_in, usd_per_mtok_out=price_out)
            for model, (price_in, price_out) in PRICES_USD_PER_MTOK.items()
        ],
        alerts=await budget_alerts(session, settings),
        applies_within_s=int(app_settings.CACHE_TTL_S),
    )


async def budget_alerts(session: AsyncSession, settings: Settings) -> list[AiBudgetAlert]:
    """Budgets at 80 % or more right now — the same sums `AiClient` refuses by."""

    found = ai_budget.alerts(await ai_budget.usages(session, settings))
    return [
        AiBudgetAlert(
            scope=usage.scope,
            period=usage.period,
            level="exhausted" if usage.level is ai_budget.BudgetLevel.EXHAUSTED else "warning",
            percent=usage.percent,
            spent_usd=usage.spent_usd,
            budget_usd=usage.budget_usd,
        )
        for usage in found
    ]


# --- who spent what (ADR-0081) -------------------------------------------------

#: How many people the report names. The top is what the question "who led to
#: the large spend" needs; the rest is one line with their count.
PEOPLE_LIMIT = 50


def _period_start(settings: Settings, period: SpendPeriod, now: datetime) -> datetime:
    if period == "day":
        return app_settings.day_start(settings.tz, now)
    if period == "week":
        return app_settings.week_start(settings.tz, now)
    return app_settings.month_start(settings.tz, now)


class _Line:
    """Accumulates one cut of the report."""

    def __init__(self) -> None:
        self.calls = 0
        self.failed_calls = 0
        self.unpriced_calls = 0
        self.cost_usd = Decimal(0)
        self.failed_cost_usd = Decimal(0)
        self.tokens_in = 0
        self.tokens_out = 0

    def add(self, row: ai_jobs_repo.SpendRow) -> None:
        self.calls += row.calls
        self.unpriced_calls += row.unpriced
        self.cost_usd += row.cost_usd
        self.tokens_in += row.tokens_in
        self.tokens_out += row.tokens_out
        if row.status is AiJobStatus.FAILED:
            self.failed_calls += row.calls
            self.failed_cost_usd += row.cost_usd

    def fields(self) -> dict[str, Any]:
        return dict(vars(self))


async def spend_report(
    session: AsyncSession, settings: Settings, period: SpendPeriod, now: datetime | None = None
) -> AiSpendReport:
    since = _period_start(settings, period, now or datetime.now(UTC))
    rows = await ai_jobs_repo.spend_breakdown_since(session, since=since)

    totals = _Line()
    by_group: dict[app_settings.AiGroup, _Line] = defaultdict(_Line)
    by_kind: dict[AiJobKind, _Line] = defaultdict(_Line)
    by_model: dict[str, _Line] = defaultdict(_Line)
    for row in rows:
        totals.add(row)
        by_group[AI_TASKS[row.kind].group].add(row)
        by_kind[row.kind].add(row)
        by_model[row.model].add(row)

    people = await _people(session, since=since)

    return AiSpendReport(
        period=period,
        since=since,
        totals=AiSpendLine(**totals.fields()),
        # Every group and kind is listed, spent or not: a zero is an answer.
        by_group=[
            AiGroupSpend(group=group, **by_group[group].fields()) for group in app_settings.AiGroup
        ],
        by_kind=[
            AiKindSpend(kind=kind, group=task.group, **by_kind[kind].fields())
            for kind, task in AI_TASKS.items()
        ],
        by_model=sorted(
            (AiModelSpend(model=model, **line.fields()) for model, line in by_model.items()),
            key=lambda line: (-line.cost_usd, line.model),
        ),
        people=people[:PEOPLE_LIMIT],
        people_total=len(people),
        people_limit=PEOPLE_LIMIT,
    )


async def _people(session: AsyncSession, *, since: datetime) -> list[AiPersonSpend]:
    rows = await ai_jobs_repo.spend_by_person_since(session, since=since)

    calls: dict[uuid.UUID, int] = defaultdict(int)
    failed: dict[uuid.UUID, int] = defaultdict(int)
    cost: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    groups: dict[uuid.UUID, set[app_settings.AiGroup]] = defaultdict(set)
    for row in rows:
        calls[row.requested_by] += row.calls
        failed[row.requested_by] += row.failed
        cost[row.requested_by] += row.cost_usd
        groups[row.requested_by].add(AI_TASKS[row.kind].group)

    users = await users_repo.get_many(session, user_ids=calls.keys())
    order = sorted(calls, key=lambda user_id: (-cost[user_id], -calls[user_id], str(user_id)))
    people = []
    for user_id in order:
        user = users.get(user_id)
        if user is None:
            continue
        people.append(
            AiPersonSpend(
                user_id=str(user_id),
                full_name=user.full_name,
                role=user.role.value,
                search=user.email or user.full_name,
                is_active=user.is_active,
                calls=calls[user_id],
                failed_calls=failed[user_id],
                cost_usd=cost[user_id],
                groups=[group for group in app_settings.AiGroup if group in groups[user_id]],
            )
        )
    return people


async def _audit(
    session: AsyncSession,
    *,
    actor: CurrentUser,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    ip: str | None,
) -> None:
    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action=action,
        entity="app_settings",
        before=before,
        after=after,
        ip=ip,
    )


async def update_group(
    session: AsyncSession,
    *,
    actor: CurrentUser,
    group: AiGroup,
    value: GroupOverrides,
    ip: str | None,
) -> None:
    app_settings.clear_cache()
    if not app_settings.group_has_fast(group):
        value = value.model_copy(update={"model_fast": None})
    _, groups = await app_settings.overrides(session)
    key = app_settings.group_key(group)
    await app_settings.save_group(session, group, value, by=actor.id)
    await _audit(
        session,
        actor=actor,
        action="update",
        before={"key": key, **groups[group].model_dump(mode="json")},
        after={"key": key, **value.model_dump(mode="json")},
        ip=ip,
    )


async def update_project(
    session: AsyncSession, *, actor: CurrentUser, value: ProjectOverrides, ip: str | None
) -> None:
    app_settings.clear_cache()
    project, _ = await app_settings.overrides(session)
    await app_settings.save_project(session, value, by=actor.id)
    await _audit(
        session,
        actor=actor,
        action="update",
        before={"key": app_settings.KEY_PROJECT, **project.model_dump(mode="json")},
        after={"key": app_settings.KEY_PROJECT, **value.model_dump(mode="json")},
        ip=ip,
    )


async def replace_key(
    session: AsyncSession, settings: Settings, *, actor: CurrentUser, api_key: str, ip: str | None
) -> None:
    """The value never reaches the journal — only its last four characters."""

    app_settings.clear_cache()
    previous = await app_settings.stored_key(session, settings)
    try:
        shown = await app_settings.save_key(session, settings, api_key, by=actor.id)
    except secret_box.BadEncryptionKey as error:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Ключ нельзя сохранить: ключ шифрования на сервере задан неверно. "
            "Его исправляет тот, кто обслуживает сервер.",
        ) from error
    await _audit(
        session,
        actor=actor,
        action="ai_key_replaced",
        before={"key": app_settings.KEY_API, "hint": previous.hint} if previous else None,
        after={"key": app_settings.KEY_API, "hint": shown},
        ip=ip,
    )


async def remove_key(
    session: AsyncSession, settings: Settings, *, actor: CurrentUser, ip: str | None
) -> bool:
    app_settings.clear_cache()
    previous = await app_settings.stored_key(session, settings)
    removed = await app_settings.remove_key(session)
    if removed:
        await _audit(
            session,
            actor=actor,
            action="ai_key_removed",
            before={"key": app_settings.KEY_API, "hint": previous.hint if previous else ""},
            after=None,
            ip=ip,
        )
    return removed


__all__ = [
    "budget_alerts",
    "check_key",
    "fetch_model_ids",
    "remove_key",
    "replace_key",
    "spend_report",
    "update_group",
    "update_project",
    "view",
]
