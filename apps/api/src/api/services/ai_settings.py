"""The «ИИ» section of the admin area: key, models, budgets, limits (ADR-0080)
and who spent what (ADR-0081).

Spend is shown by group, kind, model and person. The administrator has no
access to clinical data (section 5.1 of the TZ): nothing in this section reads
a request text or names a child — a person and a sum, never what they asked.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from core import ai_budget, app_settings, secret_box
from core.ai_catalog import (
    KINDS,
    Catalog,
    ModelEntry,
    Provider,
    ProviderSettings,
    host_allowed,
    model_ref,
)
from core.ai_price_map import suggest_price
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
    AiGroupSpend,
    AiGroupView,
    AiKeyCheck,
    AiKeyState,
    AiKindSpend,
    AiModelSpend,
    AiModelView,
    AiPersonSpend,
    AiPriceSuggestion,
    AiProjectView,
    AiProviderKindOption,
    AiProviderView,
    AiSettingsView,
    AiSpend,
    AiSpendLine,
    AiSpendReport,
    AiTaskView,
    KeyProblem,
    SpendPeriod,
)

#: The list of models is asked of the provider: free, needs only the key, and is
#: the cheapest honest answer to "does this key work" (ADR-0080).
ANTHROPIC_VERSION = "2023-06-01"
CHECK_TIMEOUT_S = 10.0
#: A gateway may list thousands of models; the form needs a list to pick from.
CHECK_MODELS_LIMIT = 500
_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$")


#: The most of a provider's answer that is read: a list of models is tens of
#: kilobytes; an address pointing elsewhere must not stream gigabytes in.
CHECK_BODY_MAX = 2_000_000


async def fetch_model_ids(provider: Provider, api_key: str) -> tuple[int, list[str]]:
    """HTTP status of the provider and the model ids the key may call.

    Replaced in tests: the suite never goes to the network. Only ids of a
    narrow alphabet come back — the address is the administrator's, and the
    answer of an arbitrary server must not travel to the screen as is. The
    whole exchange is bounded in time and size; redirects are not followed.
    """

    info = provider.info
    base = provider.base_url or info.default_base_url or ""
    headers: dict[str, str] = {}
    params: dict[str, str | int] = {}
    if info.auth == "x-api-key":
        headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION}
        params = {"limit": 1000}
    elif info.auth == "bearer" and api_key:
        headers = {"Authorization": f"Bearer {api_key}"}
    elif info.auth == "query":
        # A header, not `?key=`: a key in the address ends up in proxy logs
        # and in error-report breadcrumbs.
        headers = {"x-goog-api-key": api_key}
        params = {"pageSize": 1000}

    async with (
        asyncio.timeout(CHECK_TIMEOUT_S),
        httpx.AsyncClient(timeout=CHECK_TIMEOUT_S, follow_redirects=False) as client,
        client.stream("GET", base + info.models_path, params=params, headers=headers) as response,
    ):
        if response.status_code != 200:
            return response.status_code, []
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > CHECK_BODY_MAX:
                return 200, []
    try:
        parsed = json.loads(bytes(body))
    except ValueError:
        return 200, []
    items = parsed.get(info.list_key, []) if isinstance(parsed, dict) else []
    ids: list[str] = []
    for item in items if isinstance(items, list) else []:
        raw = item.get(info.id_key) if isinstance(item, dict) else None
        if not isinstance(raw, str):
            continue
        # Gemini lists `models/gemini-…`; the id to call is what follows.
        model = raw.removeprefix("models/")
        if _MODEL_ID.match(model):
            ids.append(model)
    return 200, ids


async def check_key(
    session: AsyncSession, settings: Settings, provider_id: str, api_key: str | None
) -> AiKeyCheck:
    """Ask the provider for its models with the key given, or the stored one."""

    models = await app_settings.catalog(session, settings)
    provider = _provider_or_404(models, provider_id)

    def failed(problem: KeyProblem) -> AiKeyCheck:
        return AiKeyCheck(ok=False, problem=problem, models=[], in_catalog=[])

    key = (api_key or "").strip() or provider.api_key
    if provider.info.needs_key and not key:
        return failed("not_configured")
    if not (provider.base_url or provider.info.default_base_url):
        return failed("no_address")
    if not provider.host_allowed:
        return failed("host_not_allowed")
    try:
        status, ids = await fetch_model_ids(provider, key)
    except (httpx.HTTPError, httpx.InvalidURL, ValueError, TimeoutError, OSError):
        return failed("unreachable")
    if status == 200:
        found = sorted(set(ids))[:CHECK_MODELS_LIMIT]
        return AiKeyCheck(
            ok=True,
            problem=None,
            models=found,
            in_catalog=[model for model in found if model_ref(provider.id, model) in models.models],
        )
    if status in (400, 401):
        # Gemini answers a bad key with 400, the rest with 401.
        return failed("unauthorized")
    if status == 403:
        return failed("forbidden")
    return failed("unexpected")


def _provider_or_404(models: Catalog, provider_id: str) -> Provider:
    provider = models.providers.get(provider_id)
    if provider is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Такого подключения нет.")
    return provider


def _spend_of(totals: dict[AiJobKind, Decimal], kinds: list[AiJobKind] | None) -> Decimal:
    if kinds is None:
        return sum(totals.values(), Decimal(0))
    return sum((totals.get(kind, Decimal(0)) for kind in kinds), Decimal(0))


def _in_use_of_provider(models: Catalog, used: set[str], provider_id: str) -> list[str]:
    return sorted(
        ref
        for ref in used
        if ref in models.models and models.models[ref].provider_id == provider_id
    )


def _refs_in_use(groups: dict[AiGroup, GroupOverrides]) -> set[str]:
    """Model references chosen by a group or a task."""

    used: set[str] = set()
    for own in groups.values():
        if own.model:
            used.add(own.model)
        used.update(own.task_models.values())
    return used


async def view(session: AsyncSession, settings: Settings) -> AiSettingsView:
    # The administrator sees what is stored, not this process's copy: the API
    # may run in several processes, and another one may have just saved.
    app_settings.clear_cache()
    project, groups = await app_settings.overrides(session)
    models = await app_settings.catalog(session, settings)
    used = _refs_in_use(groups)

    today = await ai_jobs_repo.cost_by_kind_since(
        session, since=app_settings.day_start(settings.tz)
    )
    month = await ai_jobs_repo.cost_by_kind_since(
        session, since=app_settings.month_start(settings.tz)
    )

    provider_views = []
    for provider in models.providers.values():
        stored = await app_settings.stored_key(session, settings, provider.id)
        author = (
            await users_repo.get(session, stored.updated_by)
            if stored is not None and stored.updated_by is not None
            else None
        )
        provider_views.append(
            AiProviderView(
                id=provider.id,
                kind=provider.kind,
                name=provider.name,
                base_url=provider.base_url,
                enabled=provider.enabled,
                builtin=provider.builtin,
                ready=provider.ready,
                host_allowed=provider.host_allowed,
                key=AiKeyState(
                    configured=bool(provider.api_key),
                    source=provider.key_source,
                    hint=stored.hint if stored is not None else None,
                    unreadable=stored is not None and stored.value is None,
                    updated_at=stored.updated_at if stored is not None else None,
                    updated_by_name=author.full_name if author is not None else None,
                ),
                models_count=sum(
                    1 for entry in models.models.values() if entry.provider_id == provider.id
                ),
            )
        )

    group_views = []
    for group in AiGroup:
        own = groups[group]
        kinds = app_settings.kinds_of(group)
        tasks = []
        for kind in kinds:
            ref, source = app_settings.effective_task_model(kind, own, settings)
            tasks.append(
                AiTaskView(
                    kind=kind,
                    per_person=AI_TASKS[kind].per_person,
                    model=own.task_models.get(kind),
                    effective_model=ref,
                    source=source,
                    usable=models.usable(ref),
                )
            )
        group_views.append(
            AiGroupView(
                group=group,
                kinds=kinds,
                per_person_kinds=[kind for kind in kinds if AI_TASKS[kind].per_person],
                enabled=own.enabled,
                model=own.model,
                tasks=tasks,
                daily_budget_usd=own.daily_budget_usd,
                monthly_budget_usd=own.monthly_budget_usd,
                user_daily_limit=own.user_daily_limit,
                user_daily_budget_usd=own.user_daily_budget_usd,
                default_user_daily_limit=settings.ai_user_daily_limit,
                spend=AiSpend(today_usd=_spend_of(today, kinds), month_usd=_spend_of(month, kinds)),
            )
        )

    return AiSettingsView(
        providers=provider_views,
        provider_kinds=[
            AiProviderKindOption(
                kind=kind,
                needs_key=info.needs_key,
                needs_base_url=info.needs_base_url,
                default_base_url=info.default_base_url,
            )
            for kind, info in KINDS.items()
        ],
        models=[
            AiModelView(
                ref=entry.ref,
                provider=entry.provider_id,
                model=entry.model,
                name=entry.name,
                usd_per_mtok_in=entry.usd_per_mtok_in,
                usd_per_mtok_out=entry.usd_per_mtok_out,
                enabled=entry.enabled,
                builtin=entry.builtin,
                overridden=entry.overridden,
                usable=models.usable(entry.ref),
                in_use=entry.ref in used,
            )
            for entry in models.models.values()
        ],
        project=AiProjectView(
            daily_budget_usd=project.daily_budget_usd,
            monthly_budget_usd=project.monthly_budget_usd,
            default_daily_budget_usd=Decimal(str(settings.ai_daily_budget_usd)),
            warn_percent=project.warn_percent,
            default_warn_percent=app_settings.WARN_PERCENT_DEFAULT,
            spend=AiSpend(today_usd=_spend_of(today, None), month_usd=_spend_of(month, None)),
        ),
        groups=group_views,
        alerts=await budget_alerts(session, settings),
        encryption=secret_box.key_source(settings),
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
    settings: Settings,
    *,
    actor: CurrentUser,
    group: AiGroup,
    value: GroupOverrides,
    ip: str | None,
) -> None:
    app_settings.clear_cache()
    models = await app_settings.catalog(session, settings)
    foreign = [kind.value for kind in value.task_models if AI_TASKS[kind].group is not group]
    if foreign:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Задача относится к другой группе: её модель выбирается там.",
            details={"kinds": foreign},
        )
    # A model that is not in the catalogue has no price: the budget would not
    # count it. Switched-off entries are refused too — choosing one would
    # silently run the group on the fallback.
    # A chosen model is used as chosen, never replaced (ADR-0082): one that
    # cannot be called now would make the tasks refuse.
    chosen = {ref for ref in (value.model, *value.task_models.values()) if ref}
    unknown = sorted(ref for ref in chosen if not models.usable(ref))
    if unknown:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Эту модель сейчас вызвать нельзя: её нет в каталоге, она или её подключение "
            "выключены, либо у подключения нет ключа: " + ", ".join(unknown) + ".",
            details={"models": unknown},
        )

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


# --- providers (ADR-0082) --------------------------------------------------------


def _provider_snapshot(provider_id: str, value: ProviderSettings) -> dict[str, Any]:
    return {"key": app_settings.provider_key(provider_id), **value.model_dump(mode="json")}


def _require_address(value: ProviderSettings, settings: Settings) -> None:
    if KINDS[value.kind].needs_base_url and not value.base_url:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Этому виду подключения нужен адрес сервера.",
            details={"field": "base_url"},
        )
    if not host_allowed(value.base_url, settings.ai_provider_hosts):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Этот адрес не входит в список разрешённых на сервере (AI_PROVIDER_HOSTS). "
            "Список задаёт тот, кто обслуживает сервер.",
            details={"field": "base_url"},
        )


async def create_provider(
    session: AsyncSession,
    settings: Settings,
    *,
    actor: CurrentUser,
    value: ProviderSettings,
    ip: str | None,
) -> str:
    app_settings.clear_cache()
    _require_address(value, settings)
    provider_id = await app_settings.new_provider_id(session, value.kind)
    await app_settings.save_provider(session, provider_id, value, by=actor.id)
    await _audit(
        session,
        actor=actor,
        action="ai_provider_added",
        before=None,
        after=_provider_snapshot(provider_id, value),
        ip=ip,
    )
    return provider_id


async def update_provider(
    session: AsyncSession,
    settings: Settings,
    *,
    actor: CurrentUser,
    provider_id: str,
    value: ProviderSettings,
    ip: str | None,
) -> None:
    app_settings.clear_cache()
    models = await app_settings.catalog(session, settings)
    provider = _provider_or_404(models, provider_id)
    if provider.builtin:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Встроенное подключение не меняется — у него задаётся только ключ. "
            "Для другого адреса или второго ключа добавьте ещё одно подключение.",
        )
    if value.kind is not provider.kind:
        # The kind decides how catalogue entries are called: changing it under
        # them would send a model id to a provider that does not know it.
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Вид подключения не меняется. Добавьте новое подключение нужного вида.",
            details={"field": "kind"},
        )
    _require_address(value, settings)
    if not value.enabled and provider.enabled:
        _, groups = await app_settings.overrides(session)
        used = _in_use_of_provider(models, _refs_in_use(groups), provider_id)
        if used:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Модели этого подключения выбраны в группах задач: "
                + ", ".join(used)
                + ". Выключенное подключение их не заменит другими — сначала выберите там "
                "другие модели.",
                details={"models": used},
            )
    before = ProviderSettings(
        kind=provider.kind, name=provider.name, base_url=provider.base_url, enabled=provider.enabled
    )
    dropped = await app_settings.save_provider(session, provider_id, value, by=actor.id)
    await _audit(
        session,
        actor=actor,
        action="update",
        before=_provider_snapshot(provider_id, before),
        # A key typed for one address is never sent to another: changing the
        # address drops it, and the journal says so.
        after={**_provider_snapshot(provider_id, value), "key_dropped": dropped},
        ip=ip,
    )


async def remove_provider(
    session: AsyncSession,
    settings: Settings,
    *,
    actor: CurrentUser,
    provider_id: str,
    ip: str | None,
) -> None:
    """Remove a connection together with its catalogue entries."""

    app_settings.clear_cache()
    models = await app_settings.catalog(session, settings)
    provider = _provider_or_404(models, provider_id)
    if provider.builtin:
        raise ApiError(ErrorCode.CONFLICT, "Встроенное подключение убрать нельзя.")
    _, groups = await app_settings.overrides(session)
    used = _in_use_of_provider(models, _refs_in_use(groups), provider_id)
    if used:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Модели этого подключения выбраны в группах задач: "
            + ", ".join(used)
            + ". Сначала выберите там другие.",
            details={"models": used},
        )
    kept = [e for e in await app_settings.stored_models(session) if e.provider != provider_id]
    await app_settings.save_models(session, kept, by=actor.id)
    await app_settings.remove_provider(session, provider_id)
    await _audit(
        session,
        actor=actor,
        action="ai_provider_removed",
        before=_provider_snapshot(
            provider_id,
            ProviderSettings(
                kind=provider.kind,
                name=provider.name,
                base_url=provider.base_url,
                enabled=provider.enabled,
            ),
        ),
        after=None,
        ip=ip,
    )


async def replace_key(
    session: AsyncSession,
    settings: Settings,
    *,
    actor: CurrentUser,
    provider_id: str,
    api_key: str,
    ip: str | None,
) -> None:
    """The value never reaches the journal — only its last four characters."""

    app_settings.clear_cache()
    _provider_or_404(await app_settings.catalog(session, settings), provider_id)
    previous = await app_settings.stored_key(session, settings, provider_id)
    try:
        shown = await app_settings.save_key(
            session, settings, api_key, by=actor.id, provider_id=provider_id
        )
    except secret_box.BadEncryptionKey as error:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Ключ нельзя сохранить: ключ шифрования на сервере задан неверно. "
            "Его исправляет тот, кто обслуживает сервер.",
        ) from error
    key = app_settings.provider_key(provider_id)
    await _audit(
        session,
        actor=actor,
        action="ai_key_replaced",
        before={"key": key, "hint": previous.hint} if previous else None,
        after={"key": key, "hint": shown},
        ip=ip,
    )


async def remove_key(
    session: AsyncSession,
    settings: Settings,
    *,
    actor: CurrentUser,
    provider_id: str,
    ip: str | None,
) -> bool:
    app_settings.clear_cache()
    models = await app_settings.catalog(session, settings)
    provider = _provider_or_404(models, provider_id)
    if not provider.builtin:
        _, groups = await app_settings.overrides(session)
        used = _in_use_of_provider(models, _refs_in_use(groups), provider_id)
        if used:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Модели этого подключения выбраны в группах задач: "
                + ", ".join(used)
                + ". Без ключа они перестанут отвечать — сначала выберите там другие.",
                details={"models": used},
            )
    previous = await app_settings.stored_key(session, settings, provider_id)
    removed = await app_settings.remove_key(session, provider_id, by=actor.id)
    if removed:
        await _audit(
            session,
            actor=actor,
            action="ai_key_removed",
            before={
                "key": app_settings.provider_key(provider_id),
                "hint": previous.hint if previous else "",
            },
            after=None,
            ip=ip,
        )
    return removed


# --- the catalogue of models (ADR-0082) ---------------------------------------------


async def save_model(
    session: AsyncSession,
    settings: Settings,
    *,
    actor: CurrentUser,
    value: ModelEntry,
    ip: str | None,
) -> None:
    """Add a model to the catalogue or change its price, name or switch."""

    app_settings.clear_cache()
    models = await app_settings.catalog(session, settings)
    _provider_or_404(models, value.provider)
    previous = models.models.get(value.ref)
    if not value.enabled:
        _, groups = await app_settings.overrides(session)
        if value.ref in _refs_in_use(groups):
            raise ApiError(
                ErrorCode.CONFLICT,
                "Модель выбрана в группе задач. Выключенную её ничто не заменит — "
                "сначала выберите там другую.",
            )
    entries = [e for e in await app_settings.stored_models(session) if e.ref != value.ref]
    await app_settings.save_models(session, [*entries, value], by=actor.id)
    await _audit(
        session,
        actor=actor,
        action="ai_model_saved",
        before=(
            {
                "key": value.ref,
                "usd_per_mtok_in": str(previous.usd_per_mtok_in),
                "usd_per_mtok_out": str(previous.usd_per_mtok_out),
                "enabled": previous.enabled,
            }
            if previous is not None
            else None
        ),
        after={"key": value.ref, **value.model_dump(mode="json")},
        ip=ip,
    )


async def remove_model(
    session: AsyncSession, settings: Settings, *, actor: CurrentUser, ref: str, ip: str | None
) -> None:
    """Remove the administrator's entry. A built-in model returns to its
    built-in price; one added in the cabinet leaves the catalogue."""

    app_settings.clear_cache()
    entries = await app_settings.stored_models(session)
    own = next((entry for entry in entries if entry.ref == ref), None)
    if own is None:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "Этой записи в кабинете нет. Встроенную модель убрать нельзя — её можно выключить.",
        )
    models = await app_settings.catalog(session, settings)
    _, groups = await app_settings.overrides(session)
    entry = models.models.get(ref)
    if ref in _refs_in_use(groups) and (entry is None or not entry.builtin):
        raise ApiError(
            ErrorCode.CONFLICT,
            "Модель выбрана в группе задач. Сначала выберите там другую.",
        )
    await app_settings.save_models(session, [e for e in entries if e.ref != ref], by=actor.id)
    await _audit(
        session,
        actor=actor,
        action="ai_model_removed",
        before={"key": ref, **own.model_dump(mode="json")},
        after=None,
        ip=ip,
    )


async def price_suggestion(
    session: AsyncSession, settings: Settings, provider_id: str, model: str
) -> AiPriceSuggestion:
    provider = _provider_or_404(await app_settings.catalog(session, settings), provider_id)
    found = suggest_price(provider.info.route, model.strip())
    if found is None:
        return AiPriceSuggestion(known=False, usd_per_mtok_in=None, usd_per_mtok_out=None)
    return AiPriceSuggestion(known=True, usd_per_mtok_in=found[0], usd_per_mtok_out=found[1])


__all__ = [
    "budget_alerts",
    "check_key",
    "create_provider",
    "fetch_model_ids",
    "price_suggestion",
    "remove_key",
    "remove_model",
    "remove_provider",
    "replace_key",
    "save_model",
    "spend_report",
    "update_group",
    "update_provider",
    "update_project",
    "view",
]
