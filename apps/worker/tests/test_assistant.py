"""Воронка помощника: порядок шагов и есть защита (раздел 10.4 ТЗ).

Проверяется не «отвечает ли», а то, что каждый шаг снимает свой класс
опасности: пустая база — не идём к модели; запретный вопрос — не идём к модели;
запретный ответ — заменяем шаблоном; выдуманная ссылка — заменяем шаблоном.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from core.knowledge.indexer import reindex
from worker.ai.assistant import DOCTOR_TEMPLATE, NO_MATERIAL, answer
from worker.ai.client import AiClient

from .test_ai_client import (
    FakeAnthropic,
    FakeBlock,
    FakeMessages,
    FakeResponse,
    FakeUsage,
    settings_with,
)

ARTICLE = """---
id: how-to-record-ketones
title: Как записать кетоны
kind: product
status: approved
version: 1
source: docs/TZ_AI_AGENTS.md#7.3
---

# Как записать кетоны

## Короткий ответ

Кнопка «Кетоны» в чате с ботом или раздел «Дневник» в кабинете.
"""


def says(text: str) -> FakeMessages:
    return FakeMessages(
        FakeResponse(content=[FakeBlock(type="text", text=text)], usage=FakeUsage(200, 60))
    )


def client_for(sessionmaker: async_sessionmaker, messages: FakeMessages, **overrides) -> AiClient:
    return AiClient(
        sessionmaker=sessionmaker,
        anthropic=FakeAnthropic(messages),
        settings=settings_with(**overrides),
    )


@pytest.fixture
async def indexed(sessionmaker: async_sessionmaker, tmp_path):
    (tmp_path / "product").mkdir()
    (tmp_path / "product" / "how-to-record-ketones.md").write_text(ARTICLE, encoding="utf-8")
    async with sessionmaker() as session:
        await reindex(session, root=tmp_path)
        await session.commit()
    return tmp_path


class TestNoMaterialNoModel:
    async def test_unknown_topic_never_reaches_the_model(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        """Главный инвариант: без материала любой ответ модели был бы её
        собственным измышлением о ребёнке на терапии (ADR-0021)."""

        messages = says("что-нибудь придумаю")
        async with sessionmaker() as session:
            result = await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="какие витамины давать при кетодиете",
            )

        assert result.text == NO_MATERIAL
        assert result.blocked
        assert messages.calls == []

    async def test_empty_question_is_not_asked(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        messages = says("...")
        async with sessionmaker() as session:
            result = await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="   ",
            )

        assert result.blocked
        assert messages.calls == []


class TestForbiddenQuestion:
    async def test_dose_question_is_refused_before_the_model(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        """Платить за ответ, который всё равно не покажем, незачем."""

        messages = says("Дайте 300 мг")
        async with sessionmaker() as session:
            result = await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="Увеличьте дозу депакина до 300 мг?",
            )

        assert result.text == DOCTOR_TEMPLATE
        assert messages.calls == []


class TestAnswerIsChecked:
    async def test_useful_answer_passes_with_sources(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        messages = says(
            "Кетоны записываются кнопкой «Кетоны» в чате с ботом. [[kb:how-to-record-ketones]]"
        )
        async with sessionmaker() as session:
            result = await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="куда записать кетоны",
            )

        assert not result.blocked
        assert result.sources == ("how-to-record-ketones",)
        # Пометки не показываются человеку: статьи идут отдельным списком.
        assert "[[kb:" not in result.text
        assert result.ai_job_id is not None

    async def test_forbidden_answer_is_replaced(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        """Модель может нарушить промпт: он просьба, а не гарантия."""

        messages = says("Дайте половину таблетки на ночь [[kb:how-to-record-ketones]]")
        async with sessionmaker() as session:
            result = await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="куда записать кетоны",
            )

        assert result.text == DOCTOR_TEMPLATE
        assert result.blocked
        # Обращение состоялось и записано в журнал: оно стоило денег.
        assert result.ai_job_id is not None

    async def test_invented_source_is_not_shown(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        """Выдуманная ссылка выглядит как настоящая: семья пойдёт искать статью,
        которой нет, и решит, что ответ подтверждён."""

        messages = says("Держите ответ [[kb:ketogenic-diet-basics]]")
        async with sessionmaker() as session:
            result = await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="куда записать кетоны",
            )

        assert result.text == DOCTOR_TEMPLATE
        assert "ketogenic-diet-basics" in result.reason

    async def test_materials_reach_the_model(
        self, sessionmaker, user_id, patient_id, indexed
    ) -> None:
        messages = says("Ответ [[kb:how-to-record-ketones]]")
        async with sessionmaker() as session:
            await answer(
                client_for(sessionmaker, messages),
                session,
                requested_by=user_id,
                patient_id=patient_id,
                question="куда записать кетоны",
            )

        sent = messages.calls[0]
        assert "Как записать кетоны" in str(sent["messages"])
        assert "kb:id" in sent["system"] or "[[kb:" in sent["system"]
