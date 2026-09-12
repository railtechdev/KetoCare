"""Отказ помощника со стороны поставщика (раздел 10.4 ТЗ, ADR-0022).

Кабинет и Mini App не ставят подпись «Ответ по материалам приложения; он не
заменяет консультацию врача» под отказом: ответа по материалам там не было, и
утверждение о происхождении было бы ложным. Решают они это функцией `isRefusal`
в ките (`packages/ui/src/lib/assistantAnswer.ts`) по двум признакам — `blocked`
и `status`.

Здесь проверяется то, на чём эта функция стоит, и проверяется у поставщика:
подделка в тестах экрана повторяет представления автора о контракте, а не сам
контракт. Два свойства, и оба до этого держались доводом:

1. **Отказ помечается** — иначе подпись вернётся под шаблон;
2. **Тексты отказов не оставляют вопрос о ребёнке без указания на врача** —
   иначе снятая подпись и правда что-то унесёт.

Второе проверяется у двух текстов, которые заменяют ОТВЕТ (шаблон врача и «нет
материала»), и у текста недоступности. Тексты исчерпанного предела строятся на
месте возбуждения исключения и константами не являются — за них отвечает
поведенческая проверка ниже: что бы там ни было написано, отказ остаётся
помеченным.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import async_sessionmaker

from core.models.enums import AiConversationChannel
from core.repositories import ai_conversations as conversations_repo
from core.schemas.ai_conversations import ASSISTANT_UNAVAILABLE, new_message
from worker.ai.assistant import DOCTOR_TEMPLATE, NO_MATERIAL, Answer, assistant_reply
from worker.ai.client import AiError, AiLimitExceeded

#: Слова, которыми говорят о здоровье ребёнка. Служебный текст их не касается.
HEALTH_WORDS = ("ребён", "ребен", "доз", "препарат", "диет", "кетон", "грамм")


class TestRefusalTexts:
    def test_content_refusals_point_to_a_doctor(self) -> None:
        """Оба текста заменяют ОТВЕТ на вопрос о ребёнке — и ведут к врачу.

        Сократят однажды «нет материала» до «Подходящей статьи не нашлось» — и
        появится отказ по вопросу о ребёнке без единого указания на врача, то
        есть ровно то, чего раздел 10.4 не допускает. Подпись под отказом снята
        именно потому, что защитная половина живёт в самих этих текстах.
        """

        for text in (DOCTOR_TEMPLATE, NO_MATERIAL):
            assert "врач" in text.lower(), text

    def test_unavailable_text_says_nothing_about_health(self) -> None:
        """«Помощник недоступен» — про службу, а не про ребёнка.

        Поэтому под ним подпись не нужна вовсе: терять нечего.
        """

        lowered = ASSISTANT_UNAVAILABLE.lower()
        assert not [word for word in HEALTH_WORDS if word in lowered]


class TestAssistantReplyMarksRefusals:
    """Чем помечен отказ, тем и отличает его кит. Потребитель — `isRefusal`."""

    async def _conversation(
        self, sessionmaker: async_sessionmaker, user_id: uuid.UUID, patient_id: uuid.UUID
    ) -> uuid.UUID:
        async with sessionmaker() as session:
            conversation = await conversations_repo.create(
                session,
                user_id=user_id,
                patient_id=patient_id,
                channel=AiConversationChannel.WEB,
            )
            await conversations_repo.append(
                session,
                conversation=conversation,
                messages=[
                    new_message(seq=0, role="user", text="куда записать кетоны"),
                    new_message(seq=1, role="assistant", status="pending"),
                ],
            )
            await session.commit()
            return conversation.id

    async def _run(
        self,
        monkeypatch,
        sessionmaker: async_sessionmaker,
        conversation_id: uuid.UUID,
        user_id: uuid.UUID,
        patient_id: uuid.UUID,
        outcome,
    ) -> dict:
        async def fake_answer(*args: object, **kwargs: object):
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr("worker.ai.assistant.answer", fake_answer)
        monkeypatch.setattr("worker.ai.client.build_ai_client", lambda: None)
        monkeypatch.setattr("core.db.get_sessionmaker", lambda: sessionmaker)

        await assistant_reply(
            {},
            str(conversation_id),
            str(user_id),
            str(patient_id),
            "куда записать кетоны",
            1,
        )

        async with sessionmaker() as session:
            conversation = await conversations_repo.get(session, conversation_id)
            assert conversation is not None
            reply = {m.seq: m for m in conversations_repo.messages_of(conversation)}[1]
        return {
            "text": reply.text,
            "status": reply.status,
            "blocked": reply.blocked,
            "sources": list(reply.sources),
        }

    async def test_real_answer_is_not_marked(
        self, monkeypatch, sessionmaker, user_id, patient_id
    ) -> None:
        conversation_id = await self._conversation(sessionmaker, user_id, patient_id)

        reply = await self._run(
            monkeypatch,
            sessionmaker,
            conversation_id,
            user_id,
            patient_id,
            Answer(text="Кнопка «Кетоны».", sources=("how-to-record-ketones",)),
        )

        assert (reply["blocked"], reply["status"]) == (False, "done")
        assert reply["sources"] == ["how-to-record-ketones"]

    async def test_exhausted_limit_stays_marked(
        self, monkeypatch, sessionmaker, user_id, patient_id
    ) -> None:
        """Отказ по суточному пределу держится начальным `blocked = True`.

        Это единственное, что делает его отказом: текст приходит из исключения,
        и ничего в нём об отказе не говорит. «Причешут» инициализатор в `False`
        — и под «на сегодня вопросов больше нет» вернётся подпись о том, что
        это ответ по материалам приложения.
        """

        conversation_id = await self._conversation(sessionmaker, user_id, patient_id)

        reply = await self._run(
            monkeypatch,
            sessionmaker,
            conversation_id,
            user_id,
            patient_id,
            AiLimitExceeded("На сегодня вопросов к помощнику больше нет."),
        )

        assert reply["blocked"] is True
        assert reply["text"] == "На сегодня вопросов к помощнику больше нет."
        assert reply["sources"] == []

    async def test_failure_is_marked_twice(
        self, monkeypatch, sessionmaker, user_id, patient_id
    ) -> None:
        """Недоступность помечена и `blocked`, и `status` — в отличие от ручки.

        Ручка, у которой не встала задача в очередь, пишет тот же текст ТОЛЬКО
        со `status: "failed"` (ADR-0035). Поэтому кит проверяет оба признака, и
        снимать «избыточный» нельзя.
        """

        conversation_id = await self._conversation(sessionmaker, user_id, patient_id)

        reply = await self._run(
            monkeypatch,
            sessionmaker,
            conversation_id,
            user_id,
            patient_id,
            AiError("Anthropic недоступен"),
        )

        assert (reply["blocked"], reply["status"]) == (True, "failed")
        assert reply["text"] == ASSISTANT_UNAVAILABLE
        assert reply["sources"] == []
