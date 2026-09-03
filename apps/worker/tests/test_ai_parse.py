"""Разбор свободного текста (раздел 10.3 ТЗ).

Проверяется то, из-за чего разбор вообще опасен: он превращает фразу в граммы,
по которым потом считают кетосоотношение. Значит, важнее всего не «получилось
разобрать», а «не выдумал».
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from core.models.enums import AiJobKind
from worker.ai.client import AiClient, AiLimitExceeded
from worker.ai.parse import (
    MAX_PRODUCTS,
    MIN_PER_WORD,
    ProductOption,
    collect_products,
    parse,
    prompt,
)

from .test_ai_client import (
    FakeAnthropic,
    FakeBlock,
    FakeMessages,
    FakeResponse,
    FakeUsage,
    settings_with,
)

BUTTER = ProductOption(id="a1", name="Масло сливочное")
EGG = ProductOption(id="b2", name="Яйцо куриное")


def says(*texts: str) -> FakeMessages:
    """Модель, отвечающая по очереди — чтобы проверить повтор."""

    messages = FakeMessages(None)
    answers = list(texts)

    async def create(**kwargs):  # type: ignore[no-untyped-def]
        messages.calls.append(kwargs)
        text = answers.pop(0) if answers else answers_last
        return FakeResponse(content=[FakeBlock(type="text", text=text)], usage=FakeUsage(100, 50))

    answers_last = texts[-1]
    messages.create = create  # type: ignore[method-assign]
    return messages


def client_for(sessionmaker: async_sessionmaker, messages: FakeMessages) -> AiClient:
    return AiClient(
        sessionmaker=sessionmaker, anthropic=FakeAnthropic(messages), settings=settings_with()
    )


MEAL = json.dumps(
    {
        "kind": "meal",
        "meal": {
            "items": [
                {"product_id": "a1", "grams": 30, "confidence": 1},
                {"product_id": "b2", "grams": 55, "confidence": 0.7},
            ],
            "unmatched": [],
        },
        "seizure": None,
        "clarification_needed": None,
    },
    ensure_ascii=False,
)


async def run(
    sessionmaker, user_id, patient_id, messages: FakeMessages, text: str = "30 г масла и яйцо"
):
    return await parse(
        client_for(sessionmaker, messages),
        requested_by=user_id,
        patient_id=patient_id,
        text=text,
        products=[BUTTER, EGG],
    )


class TestHappyPath:
    async def test_phrase_becomes_items(self, sessionmaker, user_id, patient_id) -> None:
        parsed = await run(sessionmaker, user_id, patient_id, says(MEAL))

        assert parsed.result.kind == "meal"
        assert parsed.result.meal is not None
        assert [item.product_id for item in parsed.result.meal.items] == ["a1", "b2"]
        assert parsed.result.meal.items[1].confidence == 0.7

    async def test_names_come_from_the_catalogue_not_the_model(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        """Родитель подтверждает по названию, а не по UUID. Название берётся из
        справочника: модель вернула бы своё, а считается раскладка по нашему."""

        parsed = await run(sessionmaker, user_id, patient_id, says(MEAL))

        assert parsed.result.meal is not None
        assert [item.name_ru for item in parsed.result.meal.items] == [
            "Масло сливочное",
            "Яйцо куриное",
        ]

    async def test_products_and_prompt_reach_the_model(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        messages = says(MEAL)
        await run(sessionmaker, user_id, patient_id, messages)

        assert messages.calls[0]["system"] == prompt()
        sent = json.dumps(messages.calls[0]["messages"], ensure_ascii=False)
        assert "Масло сливочное" in sent and "a1" in sent

    async def test_fenced_json_is_accepted_without_a_second_call(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        """Одна ```-ограда — не повод платить за второе обращение."""

        messages = says(f"```json\n{MEAL}\n```")
        parsed = await run(sessionmaker, user_id, patient_id, messages)

        assert parsed.result.kind == "meal"
        assert len(messages.calls) == 1


class TestInventedDataIsRejected:
    async def test_unknown_product_id_forces_a_retry(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        """Придуманный идентификатор выглядит как настоящий и попал бы в дневник
        вместе с чужими жирами — это невалидный ответ, а не «почти верный»."""

        invented = json.dumps(
            {
                "kind": "meal",
                "meal": {
                    "items": [{"product_id": "z9", "grams": 30, "confidence": 1}],
                    "unmatched": [],
                },
                "seizure": None,
                "clarification_needed": None,
            }
        )
        messages = says(invented, MEAL)
        parsed = await run(sessionmaker, user_id, patient_id, messages)

        assert len(messages.calls) == 2
        assert "z9" in messages.calls[1]["messages"][0]["content"][-1]["text"]
        assert parsed.result.meal is not None
        assert [i.product_id for i in parsed.result.meal.items] == ["a1", "b2"]

    async def test_broken_json_is_retried_with_the_reason(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        messages = says("вот, держите: {kind: meal}", MEAL)
        parsed = await run(sessionmaker, user_id, patient_id, messages)

        assert len(messages.calls) == 2
        complaint = messages.calls[1]["messages"][0]["content"][-1]["text"]
        assert "не подошёл" in complaint
        assert parsed.result.kind == "meal"

    async def test_second_failure_becomes_a_question_to_the_human(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        """Раздел 10.3 ТЗ: второй провал → clarification_needed. Не пустая
        запись, которую родитель примет за разбор."""

        messages = says("не json", "тоже не json")
        parsed = await run(sessionmaker, user_id, patient_id, messages)

        assert len(messages.calls) == 2
        assert parsed.result.kind == "other"
        assert parsed.result.clarification_needed is not None
        assert parsed.result.meal is None

    async def test_negative_grams_do_not_pass(self, sessionmaker, user_id, patient_id) -> None:
        bad = json.dumps(
            {
                "kind": "meal",
                "meal": {
                    "items": [{"product_id": "a1", "grams": -5, "confidence": 1}],
                    "unmatched": [],
                },
                "seizure": None,
                "clarification_needed": None,
            }
        )
        messages = says(bad, MEAL)
        parsed = await run(sessionmaker, user_id, patient_id, messages)

        assert len(messages.calls) == 2
        assert parsed.result.meal is not None
        assert all(item.grams > 0 for item in parsed.result.meal.items)


class TestLimitsPassThrough:
    async def test_limit_is_not_swallowed_into_a_clarification(
        self, sessionmaker, user_id, patient_id
    ) -> None:
        """«Лимит исчерпан» и «не понял фразу» — разные ответы человеку, и
        путать их нельзя: во втором случае он перепишет фразу и упрётся снова."""

        # Бюджет, а не предел пользователя: разбор еды им не ограничен
        # намеренно — родитель кормит ребёнка столько раз, сколько нужно.
        client = AiClient(
            sessionmaker=sessionmaker,
            anthropic=FakeAnthropic(says(MEAL)),
            settings=settings_with(ai_daily_budget_usd=0.0),
        )

        with pytest.raises(AiLimitExceeded):
            await parse(
                client,
                requested_by=user_id,
                patient_id=patient_id,
                text="масло",
                products=[BUTTER],
            )


class TestProductContext:
    async def test_short_words_do_not_drag_the_whole_catalogue(
        self, sessionmaker: async_sessionmaker
    ) -> None:
        """«и», «на», «в» дают весь справочник, а он платный: токены."""

        async with sessionmaker() as session:
            found = await collect_products(session, text="и на в")
        assert found == []

    async def test_catalogue_slice_is_capped(self) -> None:
        assert MAX_PRODUCTS <= 50

    async def test_budget_is_split_between_words(self, sessionmaker) -> None:
        """Находка ревью: первое слово забирало весь лимит.

        «Масло и яйцо» уходило в модель сорока сортами масла — яйца в списке не
        было вовсе, и продукт, который в справочнике есть, попадал в
        `unmatched`.
        """

        asked: list[int] = []

        async def search(session, *, q, limit, **kwargs):
            asked.append(limit)
            return [], 0

        import worker.ai.parse as parse_module

        original = parse_module.products_repo.search
        parse_module.products_repo.search = search  # type: ignore[assignment]
        try:
            async with sessionmaker() as session:
                await collect_products(session, text="масло сливочное яйцо куриное творог")
        finally:
            parse_module.products_repo.search = original  # type: ignore[assignment]

        assert asked, "поиск не вызывался"
        assert max(asked) < MAX_PRODUCTS
        assert min(asked) >= MIN_PER_WORD


def test_prompt_forbids_advice() -> None:
    """Промпт — часть контракта: без запретов модель начнёт советовать
    (раздел 10.4 ТЗ, правило 6)."""

    text = prompt().lower()
    assert "советов" in text
    assert "диагнозов" in text
    assert "рекомендаций" in text
    assert "product_id" in text


def test_parse_kind_is_the_fast_one() -> None:
    """Разбор идёт по AI_MODEL_FAST: он короткий и его делают часто."""

    from worker.ai.client import FAST_KINDS

    assert AiJobKind.PARSE_MEAL in FAST_KINDS
