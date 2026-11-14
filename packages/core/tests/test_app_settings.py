"""Settings changed in the cabinet: the registry, the encryption, the fallback (ADR-0080)."""

from __future__ import annotations

import base64
import os
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from core import app_settings, secret_box
from core.app_settings import AI_TASKS, AiGroup, GroupOverrides, ProjectOverrides
from core.config import Settings
from core.models import AppSetting
from core.models.enums import AiJobKind


def settings_with(**overrides: Any) -> Settings:
    base = Settings()  # type: ignore[call-arg]
    return base.model_copy(
        update={
            "secret_key": "s" * 48,
            "settings_encryption_key": "",
            "anthropic_api_key": "sk-ant-from-env",
            "ai_model_fast": "claude-haiku-4-5",
            "ai_model_smart": "claude-opus-5",
            "ai_daily_budget_usd": 10.0,
            "ai_user_daily_limit": 30,
            **overrides,
        }
    )


@pytest.fixture(autouse=True)
def fresh_cache():
    app_settings.clear_cache()
    yield
    app_settings.clear_cache()


class TestTasks:
    def test_every_kind_belongs_to_one_group(self) -> None:
        """A kind outside the table would have no model, no budget and no switch."""

        assert set(AI_TASKS) == set(AiJobKind)

    def test_meal_parsing_and_file_reading_are_not_counted_per_person(self) -> None:
        assert not AI_TASKS[AiJobKind.PARSE_MEAL].per_person
        assert not AI_TASKS[AiJobKind.RECIPE_IMPORT].per_person
        assert AI_TASKS[AiJobKind.ASSISTANT].per_person

    def test_only_families_have_a_fast_task(self) -> None:
        assert app_settings.group_has_fast(AiGroup.FAMILIES)
        assert not app_settings.group_has_fast(AiGroup.TECHNICAL)
        assert not app_settings.group_has_fast(AiGroup.SPECIALISTS)


class TestValidation:
    def test_unpriced_model_is_refused(self) -> None:
        """A model without a price would count the budget as zero (`core.ai_pricing`)."""

        with pytest.raises(ValidationError):
            GroupOverrides(model="claude-opus-9000")

    def test_priced_dated_model_is_accepted(self) -> None:
        assert (
            GroupOverrides(model="claude-haiku-4-5-20251001").model == "claude-haiku-4-5-20251001"
        )

    @pytest.mark.parametrize("budget", [Decimal(0), Decimal(-1), Decimal(10001)])
    def test_budget_is_positive_and_bounded(self, budget: Decimal) -> None:
        with pytest.raises(ValidationError):
            ProjectOverrides(daily_budget_usd=budget)

    def test_unknown_field_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            GroupOverrides.model_validate({"enabled": True, "temperature": 2})


class TestSecretBox:
    def test_round_trip_and_the_key_is_not_stored_in_clear(self) -> None:
        settings = settings_with()
        token = secret_box.encrypt(settings, "sk-ant-secret-value")
        assert "sk-ant-secret-value" not in token
        assert secret_box.decrypt(settings, token) == "sk-ant-secret-value"

    def test_another_secret_key_reads_as_absent(self) -> None:
        token = secret_box.encrypt(settings_with(), "sk-ant-secret-value")
        assert secret_box.decrypt(settings_with(secret_key="t" * 48), token) is None

    def test_dedicated_key_is_used_and_survives_secret_key_rotation(self) -> None:
        dedicated = base64.urlsafe_b64encode(os.urandom(32)).decode()
        token = secret_box.encrypt(settings_with(settings_encryption_key=dedicated), "sk-ant-x")
        rotated = settings_with(settings_encryption_key=dedicated, secret_key="t" * 48)
        assert secret_box.decrypt(rotated, token) == "sk-ant-x"
        assert secret_box.key_source(rotated) == "dedicated"
        assert secret_box.key_source(settings_with()) == "derived"

    def test_malformed_dedicated_key_is_an_error_not_silence(self) -> None:
        with pytest.raises(secret_box.BadEncryptionKey):
            secret_box.encrypt(settings_with(settings_encryption_key="not-a-key"), "x")

    def test_hint_shows_four_characters(self) -> None:
        assert secret_box.hint("sk-ant-abcdef1234") == "…1234"


class TestKeyStaysOutOfRepr:
    def test_config_and_stored_key_do_not_print_the_key(self) -> None:
        """Error reporters print local variables; the key must not be among them."""

        config = app_settings.AiConfig(
            api_key="sk-ant-secret-value",
            api_key_source="admin",
            daily_budget_usd=Decimal(10),
            monthly_budget_usd=None,
            groups={},
        )
        stored = app_settings.StoredKey(
            value="sk-ant-secret-value", hint="…alue", updated_at=None, updated_by=None
        )
        assert "sk-ant-secret-value" not in repr(config)
        assert "sk-ant-secret-value" not in repr(stored)


class TestPeriods:
    def test_day_and_month_start_at_local_midnight(self) -> None:
        now = datetime(2026, 11, 14, 20, 0, tzinfo=UTC)  # 01:00 on the 15th in Tashkent
        assert app_settings.day_start("Asia/Tashkent", now) == datetime(
            2026, 11, 14, 19, 0, tzinfo=UTC
        )
        assert app_settings.month_start("Asia/Tashkent", now) == datetime(
            2026, 10, 31, 19, 0, tzinfo=UTC
        )


class TestEffectiveConfig:
    async def test_empty_table_is_the_environment(self, session) -> None:
        config = await app_settings.ai_config(session, settings_with())

        assert config.api_key == "sk-ant-from-env"
        assert config.api_key_source == "env"
        assert config.daily_budget_usd == Decimal("10.0")
        assert config.monthly_budget_usd is None
        families = config.groups[AiGroup.FAMILIES]
        assert families.enabled
        assert families.model_for(AiJobKind.PARSE_MEAL) == "claude-haiku-4-5"
        assert families.model_for(AiJobKind.ASSISTANT) == "claude-opus-5"
        assert families.daily_budget_usd is None
        assert families.user_daily_limit == 30

    async def test_cabinet_wins_over_environment(self, session) -> None:
        settings = settings_with()
        await app_settings.save_key(session, settings, "sk-ant-from-cabinet-0001", by=None)
        await app_settings.save_group(
            session,
            AiGroup.TECHNICAL,
            GroupOverrides(
                enabled=False,
                model="claude-sonnet-5",
                daily_budget_usd=Decimal("2.5"),
                user_daily_limit=5,
            ),
            by=None,
        )
        await app_settings.save_project(
            session, ProjectOverrides(monthly_budget_usd=Decimal(150)), by=None
        )

        config = await app_settings.ai_config(session, settings)

        assert config.api_key == "sk-ant-from-cabinet-0001"
        assert config.api_key_source == "admin"
        assert config.monthly_budget_usd == Decimal(150)
        assert config.daily_budget_usd == Decimal("10.0")
        technical = config.group_of(AiJobKind.RECIPE_IMPORT)
        assert not technical.enabled
        assert technical.model == "claude-sonnet-5"
        assert technical.daily_budget_usd == Decimal("2.5")
        assert technical.user_daily_limit == 5
        # The other groups keep the environment.
        assert config.groups[AiGroup.FAMILIES].model == "claude-opus-5"

    async def test_key_is_stored_encrypted(self, session) -> None:
        await app_settings.save_key(session, settings_with(), "sk-ant-from-cabinet-0001", by=None)
        row = await session.get(AppSetting, app_settings.KEY_API)

        assert "sk-ant-from-cabinet-0001" not in str(row.value)
        assert row.value["hint"] == "…0001"

    async def test_unreadable_key_falls_back_to_environment(self, session) -> None:
        """A rotated SECRET_KEY must not take AI down: the environment key works on."""

        await app_settings.save_key(session, settings_with(), "sk-ant-from-cabinet-0001", by=None)
        app_settings.clear_cache()

        rotated = settings_with(secret_key="t" * 48)
        config = await app_settings.ai_config(session, rotated)
        stored = await app_settings.stored_key(session, rotated)

        assert config.api_key == "sk-ant-from-env"
        assert config.api_key_source == "env"
        assert stored is not None and stored.value is None

    async def test_stale_model_in_a_stored_group_falls_back(self, session) -> None:
        """A model removed from the price list later falls back to the environment —
        and takes neither the group's budgets nor its limit with it."""

        session.add(
            AppSetting(
                key=app_settings.group_key(AiGroup.SPECIALISTS),
                value={
                    "enabled": False,
                    "model": "claude-retired-1",
                    "daily_budget_usd": "2",
                    "monthly_budget_usd": "40",
                    "user_daily_limit": 5,
                },
            )
        )
        await session.flush()

        config = await app_settings.ai_config(session, settings_with())
        specialists = config.groups[AiGroup.SPECIALISTS]

        assert specialists.model == "claude-opus-5"
        assert not specialists.enabled
        assert specialists.daily_budget_usd == Decimal(2)
        assert specialists.monthly_budget_usd == Decimal(40)
        assert specialists.user_daily_limit == 5

    async def test_malformed_encryption_key_reads_as_unreadable(self, session) -> None:
        """A broken SETTINGS_ENCRYPTION_KEY must not take AI and the admin screen down."""

        await app_settings.save_key(session, settings_with(), "sk-ant-from-cabinet-0001", by=None)
        app_settings.clear_cache()

        broken = settings_with(settings_encryption_key="not-a-fernet-key")
        config = await app_settings.ai_config(session, broken)
        stored = await app_settings.stored_key(session, broken)

        assert config.api_key == "sk-ant-from-env"
        assert stored is not None and stored.value is None

    async def test_removed_key_returns_to_environment(self, session) -> None:
        settings = settings_with()
        await app_settings.save_key(session, settings, "sk-ant-from-cabinet-0001", by=None)

        assert await app_settings.remove_key(session)
        assert not await app_settings.remove_key(session)
        assert (await app_settings.ai_config(session, settings)).api_key == "sk-ant-from-env"
