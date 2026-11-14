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
from core.ai_catalog import Catalog, ModelEntry, Provider, ProviderKind, ProviderSettings
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

    def test_fast_tasks_are_the_synchronous_parsers(self) -> None:
        fast = {kind for kind, task in AI_TASKS.items() if task.speed == "fast"}
        assert fast == {AiJobKind.PARSE_MEAL, AiJobKind.PARSE_EVENT}


class TestValidation:
    def test_legacy_fast_model_becomes_the_model_of_the_fast_tasks(self) -> None:
        """Rows written before ADR-0082 carry `model_fast`."""

        own = GroupOverrides.model_validate({"model": "claude-opus-5", "model_fast": "claude-x"})
        assert own.task_models == {
            AiJobKind.PARSE_MEAL: "claude-x",
            AiJobKind.PARSE_EVENT: "claude-x",
        }
        assert GroupOverrides.model_validate({"model_fast": None}).task_models == {}

    def test_blank_task_model_means_not_chosen(self) -> None:
        own = GroupOverrides(task_models={AiJobKind.ASSISTANT: "  "})
        assert own.task_models == {}

    @pytest.mark.parametrize("percent", [49, 100])
    def test_warning_share_is_bounded(self, percent: int) -> None:
        with pytest.raises(ValidationError):
            ProjectOverrides(warn_percent=percent)

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
            warn_share=Decimal("0.8"),
            groups={},
            catalog=Catalog(providers={}, models={}),
        )
        provider = Provider(
            id="openai",
            kind=ProviderKind.OPENAI,
            name="OpenAI",
            base_url=None,
            enabled=True,
            api_key="sk-ant-secret-value",
            key_source="admin",
            builtin=False,
        )
        assert "sk-ant-secret-value" not in repr(provider)
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

    def test_week_is_the_last_seven_days_including_today(self) -> None:
        now = datetime(2026, 11, 14, 20, 0, tzinfo=UTC)  # the 15th in Tashkent
        assert app_settings.week_start("Asia/Tashkent", now) == datetime(
            2026, 11, 8, 19, 0, tzinfo=UTC
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
        assert technical.model_for(AiJobKind.RECIPE_IMPORT) == "claude-sonnet-5"
        assert technical.daily_budget_usd == Decimal("2.5")
        assert technical.user_daily_limit == 5
        # The other groups keep the environment.
        assert config.groups[AiGroup.FAMILIES].model_for(AiJobKind.ASSISTANT) == "claude-opus-5"

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

    async def test_stale_model_in_a_stored_group_keeps_the_budgets(self, session) -> None:
        """A model that left the catalogue stays the group's choice — the task
        refuses rather than going elsewhere (ADR-0082) — and it takes neither
        the group's budgets nor its limit with it."""

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

        assert specialists.model_for(AiJobKind.DOCTOR_SUMMARY) == "claude-retired-1"
        assert not config.catalog.usable("claude-retired-1")
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


class TestProvidersAndCatalog:
    """Providers and models are data, not code (ADR-0082)."""

    async def test_builtin_catalogue_without_rows(self, session) -> None:
        models = await app_settings.catalog(session, settings_with())

        assert list(models.providers) == ["anthropic"]
        assert models.providers["anthropic"].ready
        opus = models.resolve("claude-opus-5")
        assert opus is not None and opus.route == "anthropic/claude-opus-5"
        dated = models.resolve("claude-haiku-4-5-20251001")
        assert dated is not None
        assert dated.model == "claude-haiku-4-5-20251001", "the snapshot is called as typed"
        assert dated.entry.usd_per_mtok_in == Decimal(1)
        assert models.resolve("claude-opus-9000") is None, "no price — no call"

    async def test_added_provider_and_model_are_callable(self, session) -> None:
        settings = settings_with()
        provider_id = await app_settings.new_provider_id(session, ProviderKind.OPENAI)
        await app_settings.save_provider(
            session, provider_id, ProviderSettings(kind=ProviderKind.OPENAI, name="OpenAI"), by=None
        )
        await app_settings.save_models(
            session,
            [
                ModelEntry(
                    provider=provider_id,
                    model="gpt-x",
                    usd_per_mtok_in=Decimal("2.5"),
                    usd_per_mtok_out=Decimal(10),
                )
            ],
            by=None,
        )

        models = await app_settings.catalog(session, settings)
        assert provider_id == "openai"
        assert models.resolve("openai/gpt-x") is None, "no key yet — nothing to call with"

        await app_settings.save_key(
            session, settings, "sk-openai-0042", by=None, provider_id="openai"
        )
        resolved = (await app_settings.catalog(session, settings)).resolve("openai/gpt-x")

        assert resolved is not None
        assert resolved.route == "openai/gpt-x"
        assert resolved.provider.api_key == "sk-openai-0042"
        assert resolved.entry.cost(tokens_in=1_000_000, tokens_out=100_000) == Decimal("3.5")
        row = await session.get(AppSetting, app_settings.provider_key("openai"))
        assert "sk-openai-0042" not in str(row.value)
        # Saving the settings again keeps the key.
        await app_settings.save_provider(
            session, "openai", ProviderSettings(kind=ProviderKind.OPENAI, name="OpenAI 2"), by=None
        )
        again = (await app_settings.catalog(session, settings)).providers["openai"]
        assert again.name == "OpenAI 2" and again.api_key == "sk-openai-0042"

    async def test_second_connection_of_a_kind_gets_its_own_id(self, session) -> None:
        first = await app_settings.new_provider_id(session, ProviderKind.ANTHROPIC)
        assert first == "anthropic-2", "the built-in one holds the bare id"
        await app_settings.save_provider(
            session,
            first,
            ProviderSettings(kind=ProviderKind.ANTHROPIC, name="Второй ключ"),
            by=None,
        )
        assert await app_settings.new_provider_id(session, ProviderKind.ANTHROPIC) == "anthropic-3"

    async def test_local_server_needs_an_address_not_a_key(self, session) -> None:
        settings = settings_with()
        await app_settings.save_provider(
            session,
            "ollama",
            ProviderSettings(
                kind=ProviderKind.OLLAMA, name="Локальный", base_url="http://10.0.0.5:11434/"
            ),
            by=None,
        )
        await app_settings.save_models(
            session,
            [
                ModelEntry(
                    provider="ollama", model="qwen3:8b", usd_per_mtok_in=0, usd_per_mtok_out=0
                )
            ],
            by=None,
        )

        resolved = (await app_settings.catalog(session, settings)).resolve("ollama/qwen3:8b")

        assert resolved is not None
        assert resolved.route == "ollama_chat/qwen3:8b"
        assert resolved.provider.base_url == "http://10.0.0.5:11434"
        assert resolved.entry.cost(tokens_in=5000, tokens_out=900) == Decimal(0), "free is a price"

    async def test_builtin_price_can_be_overridden_and_switched_off(self, session) -> None:
        settings = settings_with()
        await app_settings.save_models(
            session,
            [
                ModelEntry(
                    provider="anthropic",
                    model="claude-opus-5",
                    usd_per_mtok_in=6,
                    usd_per_mtok_out=30,
                ),
                ModelEntry(
                    provider="anthropic",
                    model="claude-sonnet-5",
                    usd_per_mtok_in=2,
                    usd_per_mtok_out=10,
                    enabled=False,
                ),
                # A new model the code does not know yet.
                ModelEntry(
                    provider="anthropic",
                    model="claude-next-1",
                    usd_per_mtok_in=4,
                    usd_per_mtok_out=20,
                ),
            ],
            by=None,
        )
        models = await app_settings.catalog(session, settings)

        assert models.models["claude-opus-5"].usd_per_mtok_in == Decimal(6)
        assert models.models["claude-opus-5"].overridden
        assert models.resolve("claude-sonnet-5") is None
        assert models.resolve("claude-next-1") is not None

    async def test_task_model_wins_and_a_choice_is_never_replaced(self, session) -> None:
        settings = settings_with()
        await app_settings.save_group(
            session,
            AiGroup.FAMILIES,
            GroupOverrides(
                model="claude-sonnet-5",
                task_models={
                    AiJobKind.ASSISTANT: "claude-fable-5",
                    AiJobKind.PARSE_EVENT: "gone/model",
                },
            ),
            by=None,
        )
        families = (await app_settings.ai_config(session, settings)).groups[AiGroup.FAMILIES]

        assert families.model_for(AiJobKind.ASSISTANT) == "claude-fable-5"
        # A fast task without its own model stays on the environment's fast one:
        # a group moved to a large model must not move the 15-second parser.
        assert families.model_for(AiJobKind.PARSE_MEAL) == "claude-haiku-4-5"
        # A chosen model that cannot be called is not replaced by another
        # provider's: the task refuses, the administrator sees why.
        assert families.model_for(AiJobKind.PARSE_EVENT) == "gone/model"

    async def test_fast_task_never_falls_to_the_smart_model(self, session) -> None:
        """An empty or misspelt AI_MODEL_FAST is a refusal naming it, not a
        synchronous parser on a model five times the price."""

        config = await app_settings.ai_config(session, settings_with(ai_model_fast=""))
        families = config.groups[AiGroup.FAMILIES]

        assert families.model_for(AiJobKind.PARSE_MEAL) == ""
        assert families.model_for(AiJobKind.ASSISTANT) == "claude-opus-5"

    async def test_warning_share_from_the_project_settings(self, session) -> None:
        settings = settings_with()
        assert (await app_settings.ai_config(session, settings)).warn_share == Decimal("0.8")
        await app_settings.save_project(session, ProjectOverrides(warn_percent=60), by=None)
        assert (await app_settings.ai_config(session, settings)).warn_share == Decimal("0.6")


class TestAddresses:
    @pytest.mark.parametrize(
        "url",
        [
            "ftp://host",
            "localhost:11434",
            "http://host:abc",
            "http://[::1",
            "http://host:99999",
            "http://host/internal/path?x=",
            "http://host/internal#frag",
            "http://user:pass@host",
            "http://host /v1",
        ],
    )
    def test_refused(self, url: str) -> None:
        with pytest.raises(ValidationError):
            ProviderSettings(kind=ProviderKind.OPENAI_COMPATIBLE, name="x", base_url=url)

    @pytest.mark.parametrize(
        "url", ["http://10.0.0.5:11434", "https://llm.example.org/v1/", "http://[::1]:8000"]
    )
    def test_accepted(self, url: str) -> None:
        value = ProviderSettings(kind=ProviderKind.OPENAI_COMPATIBLE, name="x", base_url=url)
        assert value.base_url == url.rstrip("/")

    def test_host_list(self) -> None:
        from core.ai_catalog import host_allowed

        assert host_allowed("http://anything:1", "")
        assert host_allowed(None, "api.openai.com")
        assert host_allowed("https://api.openai.com/v1", "api.openai.com, *.clinic.uz")
        assert host_allowed("http://llm.clinic.uz:8000", "*.clinic.uz")
        assert not host_allowed("http://clinic.uz.evil.org", "*.clinic.uz")
        assert not host_allowed("http://10.0.0.5", "api.openai.com")


class TestModelReferences:
    def test_builtin_model_id_has_no_slash(self) -> None:
        """It would make the same reference as another connection's model."""

        with pytest.raises(ValidationError):
            ModelEntry(
                provider="anthropic", model="openai/gpt-x", usd_per_mtok_in=1, usd_per_mtok_out=1
            )
        ModelEntry(
            provider="openrouter", model="openai/gpt-x", usd_per_mtok_in=1, usd_per_mtok_out=1
        )

    def test_reference_fits_the_journal(self) -> None:
        with pytest.raises(ValidationError):
            ModelEntry(
                provider="gateway-two-long", model="m" * 120, usd_per_mtok_in=1, usd_per_mtok_out=1
            )


class TestKeyFollowsTheAddress:
    async def test_new_address_drops_the_key(self, session) -> None:
        """A key typed for one server is never sent to another."""

        settings = settings_with()
        first = ProviderSettings(
            kind=ProviderKind.OPENAI_COMPATIBLE, name="Шлюз", base_url="https://a.example.org/v1"
        )
        await app_settings.save_provider(session, "gateway", first, by=None)
        await app_settings.save_key(
            session, settings, "gw-key-0042-long", by=None, provider_id="gateway"
        )

        renamed = first.model_copy(update={"name": "Шлюз 2"})
        assert not await app_settings.save_provider(session, "gateway", renamed, by=None)
        assert (await app_settings.catalog(session, settings)).providers["gateway"].api_key

        moved = renamed.model_copy(update={"base_url": "https://b.example.org/v1"})
        assert await app_settings.save_provider(session, "gateway", moved, by=None)
        assert (await app_settings.catalog(session, settings)).providers["gateway"].api_key == ""

    async def test_key_author_is_the_keys_not_the_rows(self, session) -> None:
        settings = settings_with()
        value = ProviderSettings(kind=ProviderKind.OPENAI, name="OpenAI")
        await app_settings.save_provider(session, "openai", value, by=None)
        await app_settings.save_key(
            session, settings, "sk-openai-0042-long", by=None, provider_id="openai"
        )
        stored = await app_settings.stored_key(session, settings, "openai")
        assert stored is not None and stored.updated_by is None
        first_at = stored.updated_at

        # Renaming the connection is not replacing the key.
        await app_settings.save_provider(
            session, "openai", value.model_copy(update={"name": "OpenAI 2"}), by=None
        )
        again = await app_settings.stored_key(session, settings, "openai")
        assert again is not None and again.updated_at == first_at
