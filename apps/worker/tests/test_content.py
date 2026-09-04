"""Черновик карточки рецепта: состав закрыт, обещаний лечения нет (п. 21)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from worker.ai.content import content_draft, draft_recipe

from .test_ai_client import (
    FakeBlock,
    FakeMessages,
    FakeResponse,
    FakeUsage,
    client_for,
)

PAYLOAD: dict[str, Any] = {
    "title": "Омлет на сливочном масле",
    "category": "breakfast",
    "servings": 1,
    "ingredients": [
        {"name_ru": "Масло сливочное 82%", "grams": 30},
        {"name_ru": "Яйцо куриное", "grams": 55},
    ],
}

STEPS = (
    "1. Растопите масло на слабом огне.\n"
    "2. Взбейте яйца вилкой и вылейте на сковороду.\n"
    "3. Готовьте 4 минуты, пока края не схватятся."
)


def says(text: str) -> FakeMessages:
    return FakeMessages(
        FakeResponse(content=[FakeBlock(type="text", text=text)], usage=FakeUsage(300, 150))
    )


class TestDraft:
    async def test_clean_steps_pass(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        draft = await draft_recipe(
            client_for(sessionmaker, says(STEPS)), requested_by=user_id, payload=PAYLOAD
        )

        assert draft.checks == []
        assert draft.instructions.startswith("1. Растопите")

    async def test_the_recipe_has_no_six_sections_and_that_is_fine(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Проверка разделов — только для сводки.

        Общий постфильтр требует шесть заголовков раздела 10.5 ТЗ; у карточки
        рецепта своя форма, и включённая проверка давала бы находку на каждом
        черновике.
        """

        draft = await draft_recipe(
            client_for(sessionmaker, says(STEPS)), requested_by=user_id, payload=PAYLOAD
        )

        assert "structure" not in {check["kind"] for check in draft.checks}

    async def test_a_health_promise_is_a_hard_finding(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """«Помогает удерживать кетоз» в карточке блюда — обещание, которого
        никто не давал."""

        text = STEPS + "\n4. Блюдо эффективно поддерживает кетоз у ребёнка."

        draft = await draft_recipe(
            client_for(sessionmaker, says(text)), requested_by=user_id, payload=PAYLOAD
        )

        assert {check["kind"] for check in draft.checks} == {"evaluation"}

    async def test_an_invented_gram_amount_is_a_finding(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Состав закрыт: граммовка не из списка ломает расчёт блюда."""

        text = "1. Растопите 45 г масла на слабом огне.\n2. Взбейте яйца."

        draft = await draft_recipe(
            client_for(sessionmaker, says(text)), requested_by=user_id, payload=PAYLOAD
        )

        assert [check["matched"] for check in draft.checks] == ["45"]

    async def test_time_temperature_and_step_numbers_are_not_findings(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Проверяются только величины состава — числа с единицей массы.

        Без этого находка была бы в каждом черновике: номера шагов, «готовьте
        4 минуты», «при 180 градусах» — ровно то, ради чего способ приготовления
        и пишут. У сводки наоборот, там проверяются все числа: придумывать в ней
        нечего.
        """

        text = "1. Готовьте 4 минуты при 180 градусах.\n2. Дайте постоять 5 минут."

        draft = await draft_recipe(
            client_for(sessionmaker, says(text)), requested_by=user_id, payload=PAYLOAD
        )

        assert draft.checks == []

    async def test_the_call_has_no_patient(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID
    ) -> None:
        """Рецепт лежит в общей библиотеке и не про конкретного ребёнка."""

        draft = await draft_recipe(
            client_for(sessionmaker, says(STEPS)), requested_by=user_id, payload=PAYLOAD
        )

        assert draft.ai_job_id is not None


class TestTask:
    async def test_the_envelope_carries_the_status(
        self,
        sessionmaker: async_sessionmaker,
        user_id: uuid.UUID,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Отказ возвращается значением: `apps/api` классы воркера не распакует."""

        # Подменяется имя, ИМПОРТИРОВАННОЕ в `content`, а не то, что в `client`:
        # модуль забрал функцию к себе при импорте, и патч по месту определения
        # прошёл бы мимо — задача пошла бы в настоящую базу.
        monkeypatch.setattr(
            "worker.ai.content.build_ai_client", lambda: client_for(sessionmaker, says(STEPS))
        )

        answer = await content_draft({}, str(user_id), PAYLOAD)

        assert answer["status"] == "ok"
        assert answer["instructions"].startswith("1. Растопите")
