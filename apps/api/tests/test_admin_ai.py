"""`/admin/ai` — AI key, models, budgets and limits in the admin area (ADR-0080)."""

from __future__ import annotations

from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from api.services import ai_settings as service
from core.models import AiJob, AuditLog
from core.models.enums import AiJobKind, AiJobStatus, UserRole

URL = "/api/v1/admin/ai"
KEY = "sk-ant-api03-cabinet-secret-value-7788"


@pytest_asyncio.fixture
async def admin(make_user):
    return await make_user(UserRole.ADMIN)


@pytest.fixture(autouse=True)
def ai_environment(monkeypatch):
    """The environment fallback these tests rely on, stated rather than taken
    from whatever `.env` the run has: CI leaves the key and models empty, a
    developer's machine does not."""

    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-test-environment-key")
    monkeypatch.setattr(settings, "ai_model_fast", "claude-haiku-4-5")
    monkeypatch.setattr(settings, "ai_model_smart", "claude-opus-5")
    monkeypatch.setattr(settings, "ai_provider_hosts", "")


class TestAccess:
    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT])
    async def test_only_the_administrator(self, client, make_user, auth_headers, role) -> None:
        user = await make_user(role)
        headers = auth_headers(user)

        assert (await client.get(URL, headers=headers)).status_code == 403
        assert (
            await client.put(
                f"{URL}/providers/anthropic/key", json={"api_key": KEY}, headers=headers
            )
        ).status_code == 403
        assert (
            await client.post(
                f"{URL}/providers", json={"kind": "openai", "name": "OpenAI"}, headers=headers
            )
        ).status_code == 403
        assert (
            await client.put(
                f"{URL}/models",
                json={
                    "provider": "anthropic",
                    "model": "claude-next-1",
                    "usd_per_mtok_in": "1",
                    "usd_per_mtok_out": "2",
                },
                headers=headers,
            )
        ).status_code == 403
        assert (
            await client.put(f"{URL}/groups/families", json={"enabled": False}, headers=headers)
        ).status_code == 403

    async def test_anonymous_is_refused(self, client) -> None:
        assert (await client.get(URL)).status_code == 401


class TestView:
    async def test_defaults_come_from_the_environment(self, client, admin, auth_headers) -> None:
        body = (await client.get(URL, headers=auth_headers(admin))).json()

        assert [group["group"] for group in body["groups"]] == [
            "technical",
            "specialists",
            "families",
        ]
        families = body["groups"][2]
        assert set(families["kinds"]) == {"assistant", "parse_meal", "parse_event"}
        assert families["per_person_kinds"] == ["assistant"]
        assert families["enabled"] is True
        assert families["model"] is None
        tasks = {task["kind"]: task for task in families["tasks"]}
        assert tasks["assistant"]["model"] is None
        assert tasks["assistant"]["source"] == "env"
        assert tasks["assistant"]["effective_model"]
        # The built-in provider and the built-in part of the catalogue.
        (provider,) = body["providers"]
        assert provider["id"] == "anthropic" and provider["builtin"] is True
        assert provider["key"]["source"] in ("env", None)
        assert provider["key"]["hint"] is None
        refs = {model["ref"] for model in body["models"]}
        assert refs >= {"claude-opus-5", "claude-haiku-4-5"}
        assert all(model["builtin"] for model in body["models"])
        assert {kind["kind"] for kind in body["provider_kinds"]} >= {
            "anthropic",
            "openai",
            "gemini",
            "ollama",
            "openai_compatible",
        }

    async def test_spend_is_summed_by_group(
        self, client, session, admin, make_user, auth_headers
    ) -> None:
        parent = await make_user(UserRole.PARENT)
        for kind, cost in ((AiJobKind.ASSISTANT, 0.5), (AiJobKind.RECIPE_IMPORT, 1.25)):
            session.add(
                AiJob(
                    kind=kind,
                    status=AiJobStatus.DONE,
                    requested_by=parent.id,
                    input={},
                    model="claude-opus-5",
                    cost_usd=cost,
                )
            )
        await session.flush()

        before = (await client.get(URL, headers=auth_headers(admin))).json()
        groups = {group["group"]: group for group in before["groups"]}

        assert Decimal(groups["families"]["spend"]["today_usd"]) >= Decimal("0.5")
        assert Decimal(groups["technical"]["spend"]["today_usd"]) >= Decimal("1.25")
        assert Decimal(before["project"]["spend"]["today_usd"]) >= Decimal("1.75")


class TestGroups:
    async def test_saved_and_audited(self, client, session, admin, auth_headers) -> None:
        body = {
            "enabled": False,
            "model": "claude-sonnet-5",
            "daily_budget_usd": "3.5",
            "monthly_budget_usd": "60",
            "user_daily_limit": 12,
        }
        response = await client.put(
            f"{URL}/groups/technical", json=body, headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        technical = response.json()["groups"][0]
        assert technical["enabled"] is False
        assert technical["model"] == "claude-sonnet-5"
        assert Decimal(technical["daily_budget_usd"]) == Decimal("3.5")
        assert technical["user_daily_limit"] == 12

        entry = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.entity == "app_settings", AuditLog.user_id == admin.id
                )
            )
        ).one()
        assert entry.action == "update"
        assert entry.before["key"] == "ai.group.technical"
        assert entry.before["enabled"] is True
        assert entry.after["enabled"] is False

    async def test_a_task_may_have_its_own_model(self, client, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/groups/technical",
            json={"model": "claude-sonnet-5", "task_models": {"recipe_import": "claude-fable-5"}},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        tasks = {task["kind"]: task for task in response.json()["groups"][0]["tasks"]}
        assert tasks["recipe_import"]["model"] == "claude-fable-5"
        assert tasks["recipe_import"]["source"] == "task"
        assert tasks["content_draft"]["model"] is None
        assert tasks["content_draft"]["effective_model"] == "claude-sonnet-5"
        assert tasks["content_draft"]["source"] == "group"
        in_use = {m["ref"] for m in response.json()["models"] if m["in_use"]}
        assert in_use == {"claude-sonnet-5", "claude-fable-5"}

    async def test_a_task_of_another_group_is_refused(self, client, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/groups/specialists",
            json={"task_models": {"assistant": "claude-opus-5"}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_money_limit_per_person(self, client, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/groups/technical",
            json={"user_daily_budget_usd": "1.5"},
            headers=auth_headers(admin),
        )
        assert Decimal(response.json()["groups"][0]["user_daily_budget_usd"]) == Decimal("1.5")

    @pytest.mark.parametrize(
        "body",
        [
            {"model": "claude-opus-9000"},
            {"daily_budget_usd": "0"},
            {"user_daily_limit": 0},
            {"temperature": 1},
        ],
    )
    async def test_invalid_values_are_refused(self, client, admin, auth_headers, body) -> None:
        response = await client.put(
            f"{URL}/groups/families", json=body, headers=auth_headers(admin)
        )
        assert response.status_code == 422

    async def test_unknown_group_is_refused(self, client, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/groups/everyone", json={"enabled": False}, headers=auth_headers(admin)
        )
        assert response.status_code == 422

    async def test_project_budget(self, client, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/project",
            json={"daily_budget_usd": "7", "monthly_budget_usd": "150"},
            headers=auth_headers(admin),
        )
        project = response.json()["project"]
        assert Decimal(project["daily_budget_usd"]) == 7
        assert Decimal(project["monthly_budget_usd"]) == 150
        assert project["warn_percent"] is None and project["default_warn_percent"] == 80

    async def test_warning_share_moves_the_alert(
        self, client, session, admin, make_user, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        await client.put(f"{URL}/groups/technical", json={"daily_budget_usd": "2"}, headers=headers)
        dietitian = await make_user(UserRole.DIETITIAN)
        session.add(_job(dietitian, AiJobKind.RECIPE_IMPORT, 1.3))
        await session.flush()

        def technical(body: dict) -> list[dict]:
            return [alert for alert in body["alerts"] if alert["scope"] == "technical"]

        assert technical((await client.get(URL, headers=headers)).json()) == []
        body = (
            await client.put(f"{URL}/project", json={"warn_percent": 60}, headers=headers)
        ).json()
        assert [alert["percent"] for alert in technical(body)] == [65]


PROVIDER_KEY = f"{URL}/providers/anthropic/key"


def _provider(body: dict, provider_id: str) -> dict:
    return next(item for item in body["providers"] if item["id"] == provider_id)


class TestKey:
    async def test_key_is_write_only(self, client, session, admin, auth_headers) -> None:
        response = await client.put(
            PROVIDER_KEY, json={"api_key": KEY}, headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        assert KEY not in response.text
        key = _provider(response.json(), "anthropic")["key"]
        assert key["source"] == "admin"
        assert key["hint"] == "…7788"
        assert key["updated_by_name"] == admin.full_name

        read_back = await client.get(URL, headers=auth_headers(admin))
        assert KEY not in read_back.text

        entries = list(
            await session.scalars(select(AuditLog).where(AuditLog.action == "ai_key_replaced"))
        )
        assert len(entries) == 1
        assert KEY not in str(entries[0].before) + str(entries[0].after)

    @pytest.mark.parametrize("value", ["short", "sk-ant with spaces inside the key"])
    async def test_malformed_key_is_refused(self, client, admin, auth_headers, value) -> None:
        response = await client.put(
            PROVIDER_KEY, json={"api_key": value}, headers=auth_headers(admin)
        )
        assert response.status_code == 422

    async def test_removing_returns_to_the_environment(
        self, client, session, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        assert (await client.delete(PROVIDER_KEY, headers=headers)).status_code == 404

        await client.put(PROVIDER_KEY, json={"api_key": KEY}, headers=headers)
        response = await client.delete(PROVIDER_KEY, headers=headers)

        assert response.status_code == 200
        key = _provider(response.json(), "anthropic")["key"]
        assert key["source"] != "admin"
        assert key["hint"] is None
        removed = (
            await session.scalars(select(AuditLog).where(AuditLog.action == "ai_key_removed"))
        ).one()
        assert removed.before["hint"] == "…7788"

    async def test_unknown_provider(self, client, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/providers/nowhere/key", json={"api_key": KEY}, headers=auth_headers(admin)
        )
        assert response.status_code == 404


class TestKeyCheck:
    async def test_working_key_lists_what_the_provider_offers(
        self, client, admin, auth_headers, monkeypatch
    ) -> None:
        seen: list[tuple[str, str]] = []

        async def fake(provider, api_key: str) -> tuple[int, list[str]]:
            seen.append((provider.id, api_key))
            return 200, ["claude-opus-5", "claude-next-1", "claude-opus-5"]

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        response = await client.post(
            f"{URL}/providers/anthropic/check", json={"api_key": KEY}, headers=auth_headers(admin)
        )

        # Everything the key opens — a model not in the catalogue yet is what
        # the administrator came to add.
        assert response.json() == {
            "ok": True,
            "problem": None,
            "models": ["claude-next-1", "claude-opus-5"],
            "in_catalog": ["claude-opus-5"],
        }
        assert seen == [("anthropic", KEY)]

    @pytest.mark.parametrize(
        ("status", "problem"), [(401, "unauthorized"), (400, "unauthorized"), (403, "forbidden")]
    )
    async def test_refused_key(
        self, client, admin, auth_headers, monkeypatch, status, problem
    ) -> None:
        async def fake(provider, api_key: str) -> tuple[int, list[str]]:
            return status, []

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        response = await client.post(
            f"{URL}/providers/anthropic/check", json={"api_key": KEY}, headers=auth_headers(admin)
        )
        assert response.json()["problem"] == problem

    async def test_without_a_key_the_one_in_effect_is_checked(
        self, client, admin, auth_headers, monkeypatch
    ) -> None:
        seen: list[str] = []

        async def fake(provider, api_key: str) -> tuple[int, list[str]]:
            seen.append(api_key)
            return 200, []

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        await client.put(PROVIDER_KEY, json={"api_key": KEY}, headers=auth_headers(admin))
        await client.post(f"{URL}/providers/anthropic/check", json={}, headers=auth_headers(admin))

        assert seen == [KEY]


class TestProviders:
    """A provider is a row in the cabinet, not a client in the code (ADR-0082).

    The consumer of `/admin/ai` is the admin cabinet
    (`apps/web/src/features/admin/useAiSettings.ts`): the shapes asserted here
    are what it reads."""

    async def test_connect_add_a_model_and_choose_it(
        self, client, session, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        created = await client.post(
            f"{URL}/providers", json={"kind": "openai", "name": "OpenAI"}, headers=headers
        )
        assert created.status_code == 200, created.text
        openai = _provider(created.json(), "openai")
        assert openai["builtin"] is False
        assert openai["ready"] is False, "no key yet"

        keyed = await client.put(
            f"{URL}/providers/openai/key", json={"api_key": "sk-openai-0042"}, headers=headers
        )
        assert _provider(keyed.json(), "openai")["ready"] is True
        assert "sk-openai-0042" not in keyed.text

        added = await client.put(
            f"{URL}/models",
            json={
                "provider": "openai",
                "model": "gpt-x",
                "name": "GPT X",
                "usd_per_mtok_in": "2.5",
                "usd_per_mtok_out": "10",
            },
            headers=headers,
        )
        assert added.status_code == 200, added.text
        model = next(m for m in added.json()["models"] if m["ref"] == "openai/gpt-x")
        assert model["usable"] is True and model["builtin"] is False
        assert _provider(added.json(), "openai")["models_count"] == 1

        chosen = await client.put(
            f"{URL}/groups/specialists", json={"model": "openai/gpt-x"}, headers=headers
        )
        assert chosen.status_code == 200, chosen.text
        summary = chosen.json()["groups"][1]["tasks"][0]
        assert summary["effective_model"] == "openai/gpt-x" and summary["usable"] is True

        # In use: neither the model nor its provider can be removed.
        assert (
            await client.delete(f"{URL}/models", params={"ref": "openai/gpt-x"}, headers=headers)
        ).status_code == 409
        assert (await client.delete(f"{URL}/providers/openai", headers=headers)).status_code == 409

        await client.put(f"{URL}/groups/specialists", json={}, headers=headers)
        removed = await client.delete(f"{URL}/providers/openai", headers=headers)
        assert removed.status_code == 200, removed.text
        assert [p["id"] for p in removed.json()["providers"]] == ["anthropic"]
        assert all(m["provider"] == "anthropic" for m in removed.json()["models"])

        actions = set(
            await session.scalars(
                select(AuditLog.action).where(
                    AuditLog.entity == "app_settings", AuditLog.user_id == admin.id
                )
            )
        )
        assert actions >= {"ai_provider_added", "ai_model_saved", "ai_provider_removed"}

    async def test_local_server_needs_an_address(self, client, admin, auth_headers) -> None:
        headers = auth_headers(admin)
        refused = await client.post(
            f"{URL}/providers", json={"kind": "ollama", "name": "Локальный"}, headers=headers
        )
        assert refused.status_code == 422

        created = await client.post(
            f"{URL}/providers",
            json={"kind": "ollama", "name": "Локальный", "base_url": "http://10.0.0.5:11434"},
            headers=headers,
        )
        assert created.status_code == 200, created.text
        assert _provider(created.json(), "ollama")["ready"] is True, "no key needed"

    @pytest.mark.parametrize("base_url", ["ftp://host", "localhost:11434", "javascript:alert(1)"])
    async def test_address_must_be_http(self, client, admin, auth_headers, base_url) -> None:
        response = await client.post(
            f"{URL}/providers",
            json={"kind": "openai_compatible", "name": "Шлюз", "base_url": base_url},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_builtin_provider_is_not_changed_or_removed(
        self, client, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        assert (
            await client.put(
                f"{URL}/providers/anthropic",
                json={"kind": "anthropic", "name": "Другое имя"},
                headers=headers,
            )
        ).status_code == 409
        assert (
            await client.delete(f"{URL}/providers/anthropic", headers=headers)
        ).status_code == 409

    async def test_kind_of_a_connection_does_not_change(self, client, admin, auth_headers) -> None:
        headers = auth_headers(admin)
        await client.post(
            f"{URL}/providers", json={"kind": "openai", "name": "OpenAI"}, headers=headers
        )
        response = await client.put(
            f"{URL}/providers/openai", json={"kind": "gemini", "name": "OpenAI"}, headers=headers
        )
        assert response.status_code == 422


class TestReviewFindings:
    """Found by the safety review of ADR-0082."""

    async def _openai_with_key(self, client, headers) -> None:
        await client.post(
            f"{URL}/providers",
            json={
                "kind": "openai_compatible",
                "name": "Шлюз",
                "base_url": "https://a.example.org/v1",
            },
            headers=headers,
        )
        await client.put(
            f"{URL}/providers/openai-compatible/key",
            json={"api_key": "gw-key-0042-long"},
            headers=headers,
        )

    async def test_a_new_address_drops_the_key(
        self, client, session, admin, auth_headers, monkeypatch
    ) -> None:
        """Otherwise the stored key goes to whatever answers at the new address."""

        headers = auth_headers(admin)
        await self._openai_with_key(client, headers)
        moved = await client.put(
            f"{URL}/providers/openai-compatible",
            json={
                "kind": "openai_compatible",
                "name": "Шлюз",
                "base_url": "https://attacker.example.net/v1",
            },
            headers=headers,
        )
        assert moved.status_code == 200, moved.text
        assert _provider(moved.json(), "openai-compatible")["key"]["configured"] is False

        sent: list[str] = []

        async def fake(provider, api_key: str) -> tuple[int, list[str]]:
            sent.append(api_key)
            return 200, []

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        await client.post(f"{URL}/providers/openai-compatible/check", json={}, headers=headers)
        assert sent == [""]

        entry = (
            await session.scalars(
                select(AuditLog)
                .where(AuditLog.entity == "app_settings", AuditLog.action == "update")
                .order_by(AuditLog.created_at.desc())
            )
        ).first()
        assert entry is not None and entry.after["key_dropped"] is True

    async def test_in_use_connection_or_model_is_not_switched_off(
        self, client, admin, auth_headers
    ) -> None:
        """Switched off, it would make the tasks refuse; nothing replaces it."""

        headers = auth_headers(admin)
        await self._openai_with_key(client, headers)
        await client.put(
            f"{URL}/models",
            json={
                "provider": "openai-compatible",
                "model": "big-1",
                "usd_per_mtok_in": "1",
                "usd_per_mtok_out": "2",
            },
            headers=headers,
        )
        chosen = await client.put(
            f"{URL}/groups/technical", json={"model": "openai-compatible/big-1"}, headers=headers
        )
        assert chosen.status_code == 200, chosen.text

        off = await client.put(
            f"{URL}/providers/openai-compatible",
            json={
                "kind": "openai_compatible",
                "name": "Шлюз",
                "base_url": "https://a.example.org/v1",
                "enabled": False,
            },
            headers=headers,
        )
        assert off.status_code == 409
        model_off = await client.put(
            f"{URL}/models",
            json={
                "provider": "openai-compatible",
                "model": "big-1",
                "usd_per_mtok_in": "1",
                "usd_per_mtok_out": "2",
                "enabled": False,
            },
            headers=headers,
        )
        assert model_off.status_code == 409
        no_key = await client.delete(f"{URL}/providers/openai-compatible/key", headers=headers)
        assert no_key.status_code == 409

    async def test_a_model_that_cannot_be_called_is_not_chosen(
        self, client, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        await client.post(
            f"{URL}/providers", json={"kind": "openai", "name": "OpenAI"}, headers=headers
        )
        await client.put(
            f"{URL}/models",
            json={
                "provider": "openai",
                "model": "gpt-x",
                "usd_per_mtok_in": "1",
                "usd_per_mtok_out": "2",
            },
            headers=headers,
        )
        response = await client.put(
            f"{URL}/groups/technical", json={"model": "openai/gpt-x"}, headers=headers
        )
        assert response.status_code == 422, "no key yet"

    async def test_host_off_the_servers_list_is_refused(
        self, client, admin, auth_headers, monkeypatch
    ) -> None:
        from core.config import get_settings

        monkeypatch.setattr(get_settings(), "ai_provider_hosts", "api.openai.com, *.clinic.uz")
        headers = auth_headers(admin)
        refused = await client.post(
            f"{URL}/providers",
            json={"kind": "openai_compatible", "name": "x", "base_url": "http://10.0.0.5:8000"},
            headers=headers,
        )
        assert refused.status_code == 422
        allowed = await client.post(
            f"{URL}/providers",
            json={"kind": "ollama", "name": "x", "base_url": "http://llm.clinic.uz:11434"},
            headers=headers,
        )
        assert allowed.status_code == 200, allowed.text

    @pytest.mark.parametrize(
        "base_url",
        ["http://host/internal/path?x=", "http://host#x", "http://user:pw@host", "http://host:abc"],
    )
    async def test_address_tricks_are_refused(self, client, admin, auth_headers, base_url) -> None:
        response = await client.post(
            f"{URL}/providers",
            json={"kind": "openai_compatible", "name": "x", "base_url": base_url},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422


class TestCatalog:
    async def test_builtin_price_is_overridden_and_restored(
        self, client, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        entry = {
            "provider": "anthropic",
            "model": "claude-opus-5",
            "usd_per_mtok_in": "6",
            "usd_per_mtok_out": "30",
        }
        changed = await client.put(f"{URL}/models", json=entry, headers=headers)
        opus = next(m for m in changed.json()["models"] if m["ref"] == "claude-opus-5")
        assert Decimal(opus["usd_per_mtok_in"]) == 6 and opus["overridden"] is True

        restored = await client.delete(
            f"{URL}/models", params={"ref": "claude-opus-5"}, headers=headers
        )
        opus = next(m for m in restored.json()["models"] if m["ref"] == "claude-opus-5")
        assert Decimal(opus["usd_per_mtok_in"]) == 5 and opus["overridden"] is False

    async def test_new_model_of_the_builtin_provider_needs_no_deploy(
        self, client, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        await client.put(
            f"{URL}/models",
            json={
                "provider": "anthropic",
                "model": "claude-next-1",
                "usd_per_mtok_in": "4",
                "usd_per_mtok_out": "20",
            },
            headers=headers,
        )
        response = await client.put(
            f"{URL}/groups/families", json={"model": "claude-next-1"}, headers=headers
        )
        assert response.status_code == 200, response.text

    @pytest.mark.parametrize(
        "patch",
        [
            {"usd_per_mtok_in": "-1"},
            {"model": "two words"},
            {"provider": "nowhere"},
            {"usd_per_mtok_out": None},
        ],
    )
    async def test_invalid_entries_are_refused(self, client, admin, auth_headers, patch) -> None:
        entry = {
            "provider": "anthropic",
            "model": "claude-next-1",
            "usd_per_mtok_in": "4",
            "usd_per_mtok_out": "20",
            **patch,
        }
        response = await client.put(f"{URL}/models", json=entry, headers=auth_headers(admin))
        assert response.status_code in (404, 422)

    async def test_switched_off_model_cannot_be_chosen(self, client, admin, auth_headers) -> None:
        headers = auth_headers(admin)
        await client.put(
            f"{URL}/models",
            json={
                "provider": "anthropic",
                "model": "claude-sonnet-5",
                "usd_per_mtok_in": "2",
                "usd_per_mtok_out": "10",
                "enabled": False,
            },
            headers=headers,
        )
        response = await client.put(
            f"{URL}/groups/families", json={"model": "claude-sonnet-5"}, headers=headers
        )
        assert response.status_code == 422

    async def test_known_price_is_suggested(self, client, admin, auth_headers, monkeypatch) -> None:
        def fake(route: str, model: str):
            return (Decimal("2.5"), Decimal(10)) if (route, model) == ("anthropic", "x-1") else None

        monkeypatch.setattr(service, "suggest_price", fake)
        headers = auth_headers(admin)
        known = await client.get(
            f"{URL}/models/price", params={"provider": "anthropic", "model": "x-1"}, headers=headers
        )
        unknown = await client.get(
            f"{URL}/models/price", params={"provider": "anthropic", "model": "y-2"}, headers=headers
        )
        assert known.json() == {"known": True, "usd_per_mtok_in": "2.5", "usd_per_mtok_out": "10"}
        assert unknown.json()["known"] is False


# --- who spent what and the 80 % warning (ADR-0081) ------------------------------


def _job(
    user, kind: AiJobKind, cost: float | None, *, status=AiJobStatus.DONE, model="claude-opus-5"
):
    return AiJob(
        kind=kind,
        status=status,
        requested_by=user.id,
        input={"secret": "never shown"},
        model=model,
        cost_usd=cost,
        tokens_in=1000,
        tokens_out=200,
    )


class TestSpendReport:
    async def test_only_the_administrator(self, client, make_user, auth_headers) -> None:
        doctor = await make_user(UserRole.DOCTOR)
        response = await client.get(f"{URL}/spend", headers=auth_headers(doctor))
        assert response.status_code == 403

    async def test_unknown_period_is_refused(self, client, admin, auth_headers) -> None:
        response = await client.get(f"{URL}/spend?period=year", headers=auth_headers(admin))
        assert response.status_code == 422

    async def test_cuts_by_group_kind_model_and_person(
        self, client, session, admin, make_user, auth_headers
    ) -> None:
        parent = await make_user(UserRole.PARENT)
        dietitian = await make_user(UserRole.DIETITIAN)
        session.add_all(
            [
                _job(parent, AiJobKind.ASSISTANT, 0.25),
                _job(parent, AiJobKind.PARSE_MEAL, 0.01, model="claude-haiku-4-5"),
                _job(dietitian, AiJobKind.RECIPE_IMPORT, 2.0),
                _job(dietitian, AiJobKind.RECIPE_IMPORT, 0.5, status=AiJobStatus.FAILED),
                # Broke off before an answer: the cost is unknown.
                _job(dietitian, AiJobKind.CONTENT_DRAFT, None, status=AiJobStatus.FAILED),
            ]
        )
        await session.flush()

        response = await client.get(f"{URL}/spend?period=day", headers=auth_headers(admin))

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["period"] == "day"
        assert body["people_limit"] == service.PEOPLE_LIMIT
        assert Decimal(body["totals"]["cost_usd"]) == Decimal("2.76")
        assert body["totals"]["calls"] == 5
        assert body["totals"]["failed_calls"] == 2
        assert Decimal(body["totals"]["failed_cost_usd"]) == Decimal("0.5")
        assert body["totals"]["unpriced_calls"] == 1

        groups = {line["group"]: line for line in body["by_group"]}
        assert list(groups) == ["technical", "specialists", "families"]
        assert Decimal(groups["technical"]["cost_usd"]) == Decimal("2.5")
        assert groups["specialists"]["calls"] == 0, "a group without spend is still listed"
        assert Decimal(groups["families"]["cost_usd"]) == Decimal("0.26")

        kinds = {line["kind"]: line for line in body["by_kind"]}
        assert kinds["recipe_import"]["group"] == "technical"
        assert kinds["recipe_import"]["calls"] == 2
        assert kinds["recipe_import"]["tokens_in"] == 2000

        models = [line["model"] for line in body["by_model"]]
        assert models[0] == "claude-opus-5", "the most expensive model first"
        assert set(models) == {"claude-opus-5", "claude-haiku-4-5"}

        people = body["people"]
        assert [person["user_id"] for person in people] == [str(dietitian.id), str(parent.id)]
        assert people[0]["role"] == "dietitian"
        assert people[0]["groups"] == ["technical"]
        assert people[0]["failed_calls"] == 2
        assert people[0]["search"] == dietitian.email
        assert people[1]["groups"] == ["families"]
        assert body["people_total"] == 2
        # A person and a sum — never what was asked.
        assert "never shown" not in response.text


class TestBudgetAlerts:
    async def test_group_at_80_percent_is_shown_in_the_section_and_on_the_home(
        self, client, session, admin, make_user, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        await client.put(f"{URL}/groups/technical", json={"daily_budget_usd": "2"}, headers=headers)
        dietitian = await make_user(UserRole.DIETITIAN)
        session.add(_job(dietitian, AiJobKind.RECIPE_IMPORT, 1.7))
        await session.flush()

        alerts = (await client.get(URL, headers=headers)).json()["alerts"]
        technical = [alert for alert in alerts if alert["scope"] == "technical"]
        assert len(technical) == 1
        alert = technical[0]
        assert (alert["period"], alert["level"], alert["percent"]) == ("day", "warning", 85)
        assert Decimal(alert["spent_usd"]) == Decimal("1.7")
        assert Decimal(alert["budget_usd"]) == Decimal("2")

        overview = (await client.get("/api/v1/admin/overview", headers=headers)).json()
        assert any(alert["scope"] == "technical" for alert in overview["ai_alerts"])
        assert Decimal(overview["ai_spend"]["today_usd"]) >= Decimal("1.7")

    async def test_settings_changes_are_readable_in_the_journal(
        self, client, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        await client.put(f"{URL}/groups/families", json={"enabled": False}, headers=headers)

        page = (
            await client.get("/api/v1/admin/audit-log?entity=app_settings", headers=headers)
        ).json()
        entry = page["items"][0]
        assert entry["payload_hidden"] is False
        assert entry["after"]["enabled"] is False
