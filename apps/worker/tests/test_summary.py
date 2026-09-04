"""Воронка сводки: черновик сохраняется всегда, вместе с находками (п. 21 этапа 4).

Главное отличие от помощника, ради которого этот файл и написан: заблокированный
ответ семье заменяется шаблоном, а забракованный черновик врачу — показывается.
Врач должен отличать «модель написала лишнее» от «система сломалась», иначе
разбирать ложные срабатывания нечем.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from core.models.enums import AiJobStatus
from core.repositories import doctor_summaries as summaries_repo
from worker.ai.client import AiError
from worker.ai.summary import UNGROUNDED_KIND, doctor_summary, summarize

from .test_ai_client import (
    FakeBlock,
    FakeMessages,
    FakeResponse,
    FakeUsage,
    client_for,
)

PAYLOAD: dict[str, Any] = {
    "period": {"from": "2026-08-01", "to": "2026-08-31", "days": 31},
    "anthropometry": {"age_months": 52, "sex": "f", "height_cm": 104.0},
    "seizures": {"entries": 6, "count": 6},
    "ketones": {"blood": {"measurements": 7, "min": 1.9, "max": 3.2, "mean": 2.4}},
}

CLEAN = (
    "## Приступы\nЗа период записано 6 приступов.\n"
    "## Кетоны\n7 замеров, от 1.9 до 3.2 ммоль/л, в среднем 2.4.\n"
    "## Вес\nданных за период нет\n"
    "## Питание\nданных за период нет\n"
    "## Приверженность\nданных за период нет\n"
    "## Замечания по данным\nданных за период нет\n"
)


def says(text: str) -> FakeMessages:
    return FakeMessages(
        FakeResponse(content=[FakeBlock(type="text", text=text)], usage=FakeUsage(400, 200))
    )


class TestSummarize:
    async def test_a_clean_draft_has_no_findings(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
    ) -> None:
        draft = await summarize(
            client_for(sessionmaker, says(CLEAN)),
            requested_by=user_id,
            patient_id=patient_id,
            payload=PAYLOAD,
        )

        assert draft.checks == []
        assert draft.ai_job_id is not None

    async def test_a_recommendation_becomes_a_hard_finding(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
    ) -> None:
        text = CLEAN.replace(
            "## Замечания по данным\nданных за период нет",
            "## Замечания по данным\nЦелесообразно обсудить коррекцию дозы.",
        )

        draft = await summarize(
            client_for(sessionmaker, says(text)),
            requested_by=user_id,
            patient_id=patient_id,
            payload=PAYLOAD,
        )

        assert [check["kind"] for check in draft.checks] == ["recommendation"]
        assert draft.checks[0]["hard"] is True
        # Текст всё равно возвращается: прятать его от врача незачем.
        assert draft.text == text

    async def test_an_invented_number_becomes_a_soft_finding(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
    ) -> None:
        """Выдуманное число подсвечивается, но утверждать не мешает.

        Врач читает цифру и сверяет её с отчётом на том же экране; запрет
        утверждения помешал бы и собственным числам врача — с приёма, из анализа.
        """

        text = CLEAN.replace("в среднем 2.4", "в среднем 4.7")

        draft = await summarize(
            client_for(sessionmaker, says(text)),
            requested_by=user_id,
            patient_id=patient_id,
            payload=PAYLOAD,
        )

        assert [check["kind"] for check in draft.checks] == [UNGROUNDED_KIND]
        assert draft.checks[0]["hard"] is False
        assert draft.checks[0]["matched"] == "4.7"

    async def test_the_call_uses_the_smart_model(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
    ) -> None:
        """Сводка — не разбор фразы: `DOCTOR_SUMMARY` не входит в `FAST_KINDS`."""

        messages = says(CLEAN)
        await summarize(
            client_for(sessionmaker, messages),
            requested_by=user_id,
            patient_id=patient_id,
            payload=PAYLOAD,
        )

        assert messages.calls[0]["model"] == "claude-opus-5"

    async def test_the_height_survives_pseudonymization(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
    ) -> None:
        """Рост доезжает до промпта — и это не самоочевидно.

        `pseudonymize` схлопывает в строку-метку любой словарь, у которого есть
        `id` и `birth_date`, вместе со всем, что лежит рядом. Положи мы рост
        внутрь словаря пациента в том виде, в каком он лежит в отчёте, он исчез
        бы молча: модель написала бы «данных о росте нет», и это читалось бы как
        отсутствие измерений, а не как дефект сборки.
        """

        messages = says(CLEAN)
        await summarize(
            client_for(sessionmaker, messages),
            requested_by=user_id,
            patient_id=patient_id,
            payload=PAYLOAD,
        )

        sent = str(messages.calls[0])
        assert "104" in sent
        assert "Ребёнок Тестовый" not in sent


class TestTask:
    async def test_the_draft_is_written_to_the_row(
        self,
        sessionmaker: async_sessionmaker,
        user_id: uuid.UUID,
        patient_id: uuid.UUID,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        summary_id = await _order(sessionmaker, user_id, patient_id)
        _serve(monkeypatch, sessionmaker, says(CLEAN))

        result = await doctor_summary({}, str(summary_id), str(user_id), str(patient_id), PAYLOAD)

        assert result["status"] == "done"
        async with sessionmaker() as session:
            saved = await summaries_repo.get(session, summary_id)
        assert saved is not None
        assert saved.status is AiJobStatus.DONE
        assert saved.draft_md == CLEAN
        assert saved.approved_md is None

    async def test_a_failure_becomes_a_visible_state(
        self,
        sessionmaker: async_sessionmaker,
        user_id: uuid.UUID,
        patient_id: uuid.UUID,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Молчащее «готовится» навсегда — худший из ответов: врач не знает,
        ждать ему или заказывать заново."""

        summary_id = await _order(sessionmaker, user_id, patient_id)

        async def boom(*_: object, **__: object) -> None:
            raise AiError("модель недоступна")

        monkeypatch.setattr("worker.ai.summary.summarize", boom)
        monkeypatch.setattr("worker.ai.client.build_ai_client", lambda: None)
        monkeypatch.setattr("core.db.get_sessionmaker", lambda: sessionmaker)

        result = await doctor_summary({}, str(summary_id), str(user_id), str(patient_id), PAYLOAD)

        assert result["status"] == "failed"
        async with sessionmaker() as session:
            saved = await summaries_repo.get(session, summary_id)
        assert saved is not None
        assert saved.status is AiJobStatus.FAILED
        assert saved.error

    async def test_an_unexpected_error_also_becomes_a_visible_state(
        self,
        sessionmaker: async_sessionmaker,
        user_id: uuid.UUID,
        patient_id: uuid.UUID,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Не только `AiError`: любой сбой обязан закрыть строку.

        Незамеченное исключение здесь ARQ повторил бы несколько раз — каждый
        повтор новый платный вызов модели, — а исчерпав попытки, оставил бы
        строку в `running`. `find_pending` возвращал бы её вечно, и сводку за
        этот период нельзя было бы заказать уже никогда.
        """

        summary_id = await _order(sessionmaker, user_id, patient_id)

        async def boom(*_: object, **__: object) -> None:
            raise ValueError("что-то посчиталось не так")

        monkeypatch.setattr("worker.ai.summary.summarize", boom)
        monkeypatch.setattr("worker.ai.client.build_ai_client", lambda: None)
        monkeypatch.setattr("core.db.get_sessionmaker", lambda: sessionmaker)

        result = await doctor_summary({}, str(summary_id), str(user_id), str(patient_id), PAYLOAD)

        assert result["status"] == "failed"
        async with sessionmaker() as session:
            saved = await summaries_repo.get(session, summary_id)
        assert saved is not None
        assert saved.status is AiJobStatus.FAILED


async def _order(
    sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
) -> uuid.UUID:
    from datetime import date

    async with sessionmaker() as session:
        summary = await summaries_repo.create(
            session,
            patient_id=patient_id,
            requested_by=user_id,
            period_start=date(2026, 8, 1),
            period_end=date(2026, 8, 31),
        )
        identifier = summary.id
        await session.commit()
    return identifier


def _serve(
    monkeypatch: pytest.MonkeyPatch, sessionmaker: async_sessionmaker, messages: FakeMessages
) -> None:
    """Подменить обе внешние связи задачи: соединение с БД и клиент модели."""

    monkeypatch.setattr("core.db.get_sessionmaker", lambda: sessionmaker)
    monkeypatch.setattr(
        "worker.ai.client.build_ai_client", lambda: client_for(sessionmaker, messages)
    )
