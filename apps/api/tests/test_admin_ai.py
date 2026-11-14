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


class TestAccess:
    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.PARENT])
    async def test_only_the_administrator(self, client, make_user, auth_headers, role) -> None:
        user = await make_user(role)
        headers = auth_headers(user)

        assert (await client.get(URL, headers=headers)).status_code == 403
        assert (
            await client.put(f"{URL}/key", json={"api_key": KEY}, headers=headers)
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
        assert families["has_fast"] is True
        assert families["enabled"] is True
        assert families["model"] is None
        assert body["groups"][0]["model_fast"] is None
        assert body["key"]["source"] in ("env", None)
        assert body["key"]["hint"] is None
        assert {model["id"] for model in body["models"]} >= {"claude-opus-5", "claude-haiku-4-5"}

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

    async def test_fast_model_is_ignored_where_there_is_no_fast_task(
        self, client, admin, auth_headers
    ) -> None:
        response = await client.put(
            f"{URL}/groups/specialists",
            json={"model_fast": "claude-haiku-4-5"},
            headers=auth_headers(admin),
        )
        assert response.json()["groups"][1]["model_fast"] is None

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


class TestKey:
    async def test_key_is_write_only(self, client, session, admin, auth_headers) -> None:
        response = await client.put(
            f"{URL}/key", json={"api_key": KEY}, headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        assert KEY not in response.text
        key = response.json()["key"]
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
            f"{URL}/key", json={"api_key": value}, headers=auth_headers(admin)
        )
        assert response.status_code == 422

    async def test_removing_returns_to_the_environment(
        self, client, session, admin, auth_headers
    ) -> None:
        headers = auth_headers(admin)
        assert (await client.delete(f"{URL}/key", headers=headers)).status_code == 404

        await client.put(f"{URL}/key", json={"api_key": KEY}, headers=headers)
        response = await client.delete(f"{URL}/key", headers=headers)

        assert response.status_code == 200
        assert response.json()["key"]["source"] != "admin"
        assert response.json()["key"]["hint"] is None
        removed = (
            await session.scalars(select(AuditLog).where(AuditLog.action == "ai_key_removed"))
        ).one()
        assert removed.before["hint"] == "…7788"


class TestKeyCheck:
    async def test_working_key_lists_priced_models(
        self, client, admin, auth_headers, monkeypatch
    ) -> None:
        seen: list[str] = []

        async def fake(api_key: str) -> tuple[int, list[str]]:
            seen.append(api_key)
            return 200, ["claude-opus-5", "claude-haiku-4-5-20251001", "claude-unpriced-x"]

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        response = await client.post(
            f"{URL}/key/check", json={"api_key": KEY}, headers=auth_headers(admin)
        )

        assert response.json() == {
            "ok": True,
            "problem": None,
            "models": ["claude-haiku-4-5-20251001", "claude-opus-5"],
        }
        assert seen == [KEY]

    @pytest.mark.parametrize(("status", "problem"), [(401, "unauthorized"), (403, "forbidden")])
    async def test_refused_key(
        self, client, admin, auth_headers, monkeypatch, status, problem
    ) -> None:
        async def fake(api_key: str) -> tuple[int, list[str]]:
            return status, []

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        response = await client.post(
            f"{URL}/key/check", json={"api_key": KEY}, headers=auth_headers(admin)
        )
        assert response.json()["problem"] == problem

    async def test_without_a_key_the_one_in_effect_is_checked(
        self, client, admin, auth_headers, monkeypatch
    ) -> None:
        seen: list[str] = []

        async def fake(api_key: str) -> tuple[int, list[str]]:
            seen.append(api_key)
            return 200, []

        monkeypatch.setattr(service, "fetch_model_ids", fake)
        await client.put(f"{URL}/key", json={"api_key": KEY}, headers=auth_headers(admin))
        await client.post(f"{URL}/key/check", json={}, headers=auth_headers(admin))

        assert seen == [KEY]
