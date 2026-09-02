"""Единственная дверь к модели: журнал, предохранители, псевдонимизация.

Проверяется поведение, ради которого клиент вообще существует (раздел 10.2 ТЗ):
без него каждая задача решала бы эти вопросы заново и по-своему.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from core.config import Settings
from core.models import AiJob
from core.models.enums import AiJobKind, AiJobStatus
from worker.ai.client import (
    AiClient,
    AiLimitExceeded,
    AiUnavailable,
    NotConfigured,
)
from worker.ai.pricing import PRICES_USD_PER_MTOK, base_model, estimate_cost, is_priced


@dataclass
class FakeUsage:
    input_tokens: int
    output_tokens: int


@dataclass
class FakeBlock:
    type: str
    text: str


@dataclass
class FakeResponse:
    content: list[FakeBlock]
    usage: FakeUsage
    stop_reason: str = "end_turn"


class FakeMessages:
    """Подстановка вместо SDK: сеть в тестах не трогается."""

    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.response


class FakeAnthropic:
    def __init__(self, messages: FakeMessages) -> None:
        self.messages = messages


def answer(text: str = "готово", tokens_in: int = 1000, tokens_out: int = 200) -> FakeResponse:
    return FakeResponse(
        content=[FakeBlock(type="text", text=text)],
        usage=FakeUsage(input_tokens=tokens_in, output_tokens=tokens_out),
    )


def settings_with(**overrides: Any) -> Settings:
    base = Settings()  # type: ignore[call-arg]
    return base.model_copy(
        update={
            "anthropic_api_key": "sk-ant-test",
            "ai_model_fast": "claude-haiku-4-5-20251001",
            "ai_model_smart": "claude-opus-5",
            "ai_daily_budget_usd": 10.0,
            "ai_user_daily_limit": 30,
            **overrides,
        }
    )


def client_for(
    sessionmaker: async_sessionmaker, messages: FakeMessages, **overrides: Any
) -> AiClient:
    return AiClient(
        sessionmaker=sessionmaker,
        anthropic=FakeAnthropic(messages),
        settings=settings_with(**overrides),
    )


async def jobs_of(sessionmaker: async_sessionmaker) -> list[AiJob]:
    async with sessionmaker() as session:
        return list(await session.scalars(select(AiJob)))


class TestJournal:
    async def test_successful_call_is_written_with_tokens_and_cost(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Без стоимости в журнале дневной бюджет считать не по чему."""

        messages = FakeMessages(answer(tokens_in=1000, tokens_out=200))
        client = client_for(sessionmaker, messages)

        result = await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={"ketones": 3.1},
        )

        jobs = await jobs_of(sessionmaker)
        assert len(jobs) == 1
        job = jobs[0]
        assert job.status == AiJobStatus.DONE
        assert job.tokens_in == 1000
        assert job.tokens_out == 200
        assert job.model == "claude-opus-5"
        assert result.cost_usd == estimate_cost("claude-opus-5", tokens_in=1000, tokens_out=200)
        assert float(job.cost_usd or 0) == pytest.approx(float(result.cost_usd or 0))

    async def test_failed_call_is_written_too(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Упавший вызов стоил столько же, сколько успешный."""

        messages = FakeMessages(error=RuntimeError("сеть недоступна"))
        client = client_for(sessionmaker, messages)

        with pytest.raises(AiUnavailable):
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )

        jobs = await jobs_of(sessionmaker)
        assert len(jobs) == 1
        assert jobs[0].status == AiJobStatus.FAILED
        assert "сеть недоступна" in (jobs[0].error or "")

    async def test_refusal_without_text_is_a_failure_with_its_tokens(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Ответ без текста — не пустая строка наружу, а отказ; токены записаны."""

        response = FakeResponse(content=[], usage=FakeUsage(500, 0), stop_reason="refusal")
        client = client_for(sessionmaker, FakeMessages(response))

        with pytest.raises(AiUnavailable):
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )

        jobs = await jobs_of(sessionmaker)
        assert jobs[0].status == AiJobStatus.FAILED
        assert jobs[0].tokens_in == 500


class TestPseudonymizationIsNotOptional:
    async def test_payload_reaches_the_model_without_names(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Чистит клиент, а не вызывающий: забыть вызов нельзя (правило 6)."""

        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages)

        await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={
                "patient": {
                    "id": "3f2a1c9d-1111-4111-8111-222222222222",
                    "full_name": "Аня Иванова",
                    "birth_date": "2021-07-15",
                    "sex": "f",
                },
                "chat_id": 4815162342,
            },
        )

        sent = json.dumps(messages.calls[0]["messages"], ensure_ascii=False)
        assert "Аня Иванова" not in sent
        assert "4815162342" not in sent
        assert "patient 3f2a1c9d" in sent

    async def test_journal_stores_what_was_sent(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """В журнале — уже очищенная нагрузка: иначе ФИО просто переехало бы в БД
        рядом с ответом модели, и «в промпт не уходит» стало бы формальностью."""

        client = client_for(sessionmaker, FakeMessages(answer()))

        await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={"patient": {"id": str(uuid.uuid4()), "full_name": "Аня Иванова"}},
        )

        jobs = await jobs_of(sessionmaker)
        assert "Аня Иванова" not in json.dumps(jobs[0].input, ensure_ascii=False)


class TestModelComesFromEnvironment:
    async def test_fast_model_for_parsing_smart_for_the_rest(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages)

        await client.ask(
            kind=AiJobKind.PARSE_MEAL,
            requested_by=user_id,
            patient_id=None,
            system="разбери",
            payload={},
        )
        assert messages.calls[0]["model"] == "claude-haiku-4-5-20251001"

        await client.ask(
            kind=AiJobKind.DOCTOR_SUMMARY,
            requested_by=user_id,
            patient_id=None,
            system="сводка",
            payload={},
        )
        assert messages.calls[1]["model"] == "claude-opus-5"

    async def test_missing_model_name_is_a_refusal_not_a_default(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Подставить имя по умолчанию значит зашить модель в код (правило 6)."""

        client = client_for(sessionmaker, FakeMessages(answer()), ai_model_smart="")

        with pytest.raises(NotConfigured):
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )
        assert await jobs_of(sessionmaker) == []


class TestLimits:
    async def test_daily_budget_stops_the_project(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        messages = FakeMessages(answer(tokens_in=1_000_000, tokens_out=0))  # ровно $5
        client = client_for(sessionmaker, messages, ai_daily_budget_usd=4.0)

        await client.ask(
            kind=AiJobKind.DOCTOR_SUMMARY,
            requested_by=user_id,
            patient_id=None,
            system="сводка",
            payload={},
        )

        with pytest.raises(AiLimitExceeded):
            await client.ask(
                kind=AiJobKind.DOCTOR_SUMMARY,
                requested_by=user_id,
                patient_id=None,
                system="сводка",
                payload={},
            )
        assert len(messages.calls) == 1

    async def test_user_limit_counts_assistant_questions(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages, ai_user_daily_limit=2)

        for _ in range(2):
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )

        with pytest.raises(AiLimitExceeded):
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )

    async def test_user_limit_does_not_block_meal_parsing(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Родитель кормит ребёнка столько раз, сколько нужно (раздел 10.2 ТЗ)."""

        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages, ai_user_daily_limit=1)

        for _ in range(3):
            await client.ask(
                kind=AiJobKind.PARSE_MEAL,
                requested_by=user_id,
                patient_id=None,
                system="разбери",
                payload={},
            )
        assert len(messages.calls) == 3

    async def test_yesterday_does_not_count(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Предел суточный: вчерашние вопросы сегодня не мешают."""

        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages, ai_user_daily_limit=1)

        await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={},
        )

        async with sessionmaker() as session:
            job = (await session.scalars(select(AiJob))).one()
            job.created_at = datetime.now(UTC) - timedelta(days=2)
            await session.commit()

        await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={},
        )
        assert len(messages.calls) == 2


class TestPricing:
    def test_dated_model_name_is_priced_like_the_model(self) -> None:
        """В `.env.example` стоит датированное имя — без обрезания даты бюджет
        переставал бы считать молча."""

        assert estimate_cost(
            "claude-haiku-4-5-20251001", tokens_in=1_000_000, tokens_out=0
        ) == Decimal("1")

    def test_unknown_model_has_no_invented_price(self) -> None:
        assert estimate_cost("some-other-model", tokens_in=100, tokens_out=100) is None


class TestBudgetCannotBeSilentlyDisabled:
    """Находка ревью: неизвестная модель обнуляла дневной бюджет навсегда."""

    async def test_unpriced_model_is_refused_not_billed_at_zero(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        # Цепочка была такая: нет цены → cost_usd NULL → сумма за день ноль →
        # AI_DAILY_BUDGET_USD не срабатывает НИКОГДА, от одной опечатки в .env.
        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages, ai_model_smart="claude-opus-9000")

        with pytest.raises(NotConfigured) as failure:
            await client.ask(
                kind=AiJobKind.ASSISTANT,
                requested_by=user_id,
                patient_id=None,
                system="ты помощник",
                payload={},
            )

        assert "прайс" in str(failure.value).lower()
        assert messages.calls == []

    def test_env_example_models_are_priced(self) -> None:
        """Значения из `.env.example` обязаны находиться в прайсе: именно они
        оказываются в свежем окружении, и именно на них проверяется бюджет."""

        example = Path(__file__).resolve().parents[3] / ".env.example"
        declared = dict(
            line.split("#")[0].strip().split("=", 1)
            for line in example.read_text().splitlines()
            if line.startswith(("AI_MODEL_FAST=", "AI_MODEL_SMART="))
        )

        assert declared, "в .env.example пропали объявления моделей"
        for variable, model in declared.items():
            assert is_priced(model), f"{variable}={model} нет в worker/ai/pricing.py"

    def test_dated_and_latest_aliases_resolve_to_the_model(self) -> None:
        assert base_model("claude-opus-5-20260101") == "claude-opus-5"
        assert base_model("claude-opus-5-latest") == "claude-opus-5"
        assert all(base_model(name) == name for name in PRICES_USD_PER_MTOK)


class TestReservation:
    """Находка ревью: пока вызов идёт, его стоимость никто не учитывал."""

    async def test_running_call_already_occupies_the_budget(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        client = client_for(sessionmaker, FakeMessages(answer()), ai_daily_budget_usd=10.0)

        await client.ask(
            kind=AiJobKind.DOCTOR_SUMMARY,
            requested_by=user_id,
            patient_id=None,
            system="сводка",
            payload={},
            max_tokens=100_000,  # бронь по потолку ответа: 100k × $25/1M = $2.5
        )

        jobs = await jobs_of(sessionmaker)
        assert jobs[0].cost_usd is not None

    async def test_reservation_is_replaced_by_the_real_cost(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Бронь завышена намеренно; после ответа в журнале должна стоять
        настоящая цена, иначе отчёт о расходах врал бы в разы."""

        client = client_for(sessionmaker, FakeMessages(answer(tokens_in=1000, tokens_out=200)))

        result = await client.ask(
            kind=AiJobKind.DOCTOR_SUMMARY,
            requested_by=user_id,
            patient_id=None,
            system="сводка",
            payload={},
            max_tokens=100_000,
        )

        jobs = await jobs_of(sessionmaker)
        assert float(jobs[0].cost_usd or 0) == pytest.approx(float(result.cost_usd or 0))
        assert result.cost_usd == estimate_cost("claude-opus-5", tokens_in=1000, tokens_out=200)


class TestFreeTextIsCleanedToo:
    async def test_contacts_from_the_user_do_not_reach_the_model(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Находка ревью: `user_text` уходил в промпт и в журнал сырым."""

        messages = FakeMessages(answer())
        client = client_for(sessionmaker, messages)

        await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=user_id,
            patient_id=None,
            system="ты помощник",
            payload={},
            user_text="позвоните мне на +998 90 111-22-33 или mama@example.com",
        )

        sent = json.dumps(messages.calls[0]["messages"], ensure_ascii=False)
        assert "mama@example.com" not in sent
        assert "111-22-33" not in sent

        jobs = await jobs_of(sessionmaker)
        assert "mama@example.com" not in json.dumps(jobs[0].input, ensure_ascii=False)


class TestSingleDoor:
    def test_sdk_is_imported_only_by_the_client(self) -> None:
        """Находка ревью: дисциплина «единственная дверь» держалась на честном
        слове. Импорт SDK мимо клиента — это обход псевдонимизации и журнала."""

        worker_src = Path(__file__).resolve().parents[1] / "src" / "worker"
        offenders = [
            path.relative_to(worker_src).as_posix()
            for path in worker_src.rglob("*.py")
            if "anthropic" in path.read_text() and path.name != "client.py"
        ]
        assert offenders == []
