"""Ассистент семьи: единственная воронка вопроса (раздел 10.4 ТЗ, п. 20).

Порядок шагов — и есть содержание этого модуля. Каждый шаг снимает свой класс
опасности, и переставить их местами значит открыть дверь, которую закрывал
предыдущий:

1. **Поиск по базе знаний.** Ничего не нашлось — модель не вызывается вовсе.
   Не ради экономии: без материала любой ответ модели будет её собственным
   измышлением о ребёнке на терапии (ADR-0021).
2. **Фильтр вопроса.** Прямая просьба о запрещённом («какую дозу дать?»)
   разворачивается до обращения к модели: платить за ответ, который всё равно
   не покажем, незачем.
3. **Обращение к модели** — через общий клиент: псевдонимизация, журнал
   `ai_jobs`, дневной бюджет и суточный предел (правило 6 CLAUDE.md).
4. **Постфильтр ответа** (`guard.py`) — четыре запрета ТЗ.
5. **Проверка ссылок.** Ответ обязан ссылаться на переданные статьи;
   выдуманный идентификатор — тот же класс, что придуманный `product_id` в
   разборе еды, и обрабатывается так же: ответ не показывается.

Наружу всегда уходит `Answer`: либо текст модели, либо шаблон. Исключений нет —
экран не должен решать, что делать с полуответом.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core import ai_trace
from core.models.enums import AiJobKind
from core.repositories import knowledge_base as kb
from core.textguard.assistant_guard import Kind, check, check_answer

from .client import AiClient, AiError, AiLimitExceeded

#: Ответ на всё, чего помощнику касаться нельзя. Формулировка — из раздела 10.4
#: ТЗ, дословно: она согласована как продуктовый текст, и переписывать её на
#: свой вкус нельзя.
DOCTOR_TEMPLATE = "Этот вопрос нужно обсудить с лечащим врачом."

#: Ответ, когда в базе знаний нет ничего подходящего.
NO_MATERIAL = (
    "Я отвечаю только по материалам приложения, и подходящей статьи не нашлось. "
    "Если вопрос о ребёнке — его нужно обсудить с лечащим врачом."
)

#: Сколько фрагментов уходит в промпт. Больше — дороже и хуже: модель начинает
#: смешивать соседние темы.
MAX_PASSAGES = 5

#: Потолок ответа. Помощник отвечает двумя-четырьмя предложениями (промпт), и
#: длинный ответ здесь означал бы, что он ушёл рассказывать своё.
MAX_TOKENS = 700

_CITATION = re.compile(r"\[\[kb:([a-z0-9-]+)\]\]")


@dataclass(frozen=True, slots=True)
class Answer:
    text: str
    #: Статьи, на которые ответ ссылается, — их показывает интерфейс.
    sources: tuple[str, ...] = ()
    #: Ответ заменён шаблоном. Экран показывает его как обычное сообщение, а не
    #: как ошибку: это ответ по существу, просто не тот, которого ждали.
    blocked: bool = False
    #: Почему заменён — для журнала и разбора ложных срабатываний.
    reason: str = ""
    #: Отказ — «в базе нет материала», а не вопрос к врачу (аудит 3.10).
    no_material: bool = False
    ai_job_id: uuid.UUID | None = None


@lru_cache(maxsize=1)
def prompt() -> str:
    """Системный промпт — файлом (раздел 10.4 ТЗ), меняется отдельным PR."""

    return (Path(__file__).parent / "prompts" / "assistant.md").read_text(encoding="utf-8")


async def answer(
    client: AiClient,
    session: AsyncSession,
    *,
    requested_by: uuid.UUID,
    patient_id: uuid.UUID,
    question: str,
) -> Answer:
    """Ответить семье на вопрос о приложении."""

    text = question.strip()
    if not text:
        return Answer(text=NO_MATERIAL, blocked=True, reason="пустой вопрос", no_material=True)

    with ai_trace.step("question_check"):
        asked = check(text)
    if asked.blocked:
        # Вопрос сам просит запрещённого. К модели не идём: ответ известен, а
        # обращение стоило бы денег и всё равно было бы заменено шаблоном.
        return Answer(text=DOCTOR_TEMPLATE, blocked=True, reason=f"вопрос: {asked.rule}")

    with ai_trace.step("search"):
        passages = await kb.search(session, q=text, limit=MAX_PASSAGES)
    if not passages:
        return Answer(
            text=NO_MATERIAL, blocked=True, reason="в базе знаний нет материала", no_material=True
        )

    known = {passage.doc_slug for passage in passages}
    payload = {
        "materials": [
            {
                "id": passage.doc_slug,
                "title": passage.doc_title,
                "section": passage.heading_path,
                "text": passage.body,
            }
            for passage in passages
        ]
    }

    try:
        reply = await client.ask(
            kind=AiJobKind.ASSISTANT,
            requested_by=requested_by,
            patient_id=patient_id,
            system=prompt(),
            payload=payload,
            user_text=text,
            max_tokens=MAX_TOKENS,
        )
    except AiLimitExceeded:
        # Предел и бюджет — не наше дело: ручка расскажет человеку своими
        # словами, что на сегодня хватит.
        raise
    except AiError:
        raise

    with ai_trace.step("answer_check"):
        verdict = check_answer(reply.text)
        cited = tuple(dict.fromkeys(_CITATION.findall(reply.text)))
    if verdict.blocked:
        return Answer(
            text=DOCTOR_TEMPLATE,
            blocked=True,
            reason=f"ответ: {verdict.rule}",
            ai_job_id=reply.job_id,
        )

    invented = [source for source in cited if source not in known]
    if invented:
        # Выдуманная ссылка выглядит как настоящая: семья пойдёт искать статью,
        # которой нет, и решит, что ответ подтверждён. Тот же класс, что
        # придуманный product_id в разборе еды.
        return Answer(
            text=DOCTOR_TEMPLATE,
            blocked=True,
            reason=f"ответ ссылается на несуществующие статьи: {', '.join(invented)}",
            ai_job_id=reply.job_id,
        )

    return Answer(
        text=_without_citations(reply.text),
        sources=cited,
        ai_job_id=reply.job_id,
    )


def _without_citations(text: str) -> str:
    """Убрать пометки `[[kb:id]]` из текста: человеку они не нужны.

    Статьи показываются отдельным списком под ответом — так их видно и можно
    открыть, а внутри предложения они читаются как мусор.
    """

    return re.sub(r"\s*" + _CITATION.pattern, "", text).strip()


#: Классы постфильтра, при которых ответ заменяется шаблоном врача. Внутренняя
#: ошибка фильтра сюда тоже входит: непроверенный ответ семья не увидит.
BLOCKING_KINDS = frozenset(Kind)


async def assistant_reply(
    ctx: dict[str, object],
    conversation_id: str,
    requested_by: str,
    patient_id: str,
    question: str,
    reply_seq: int,
) -> dict[str, object]:
    """Задача ARQ: дописать ответ помощника в переписку (раздел 10.1 ТЗ).

    Асинхронно, в отличие от разбора еды: ответ помощника идёт секунды, а ручка
    столько не ждёт — nginx перед API рвёт соединение на шестидесятой, и ответ,
    за который уже заплачено, терялся бы на границе прокси. Поэтому ручка
    кладёт в переписку пустое сообщение-ожидание, а эта задача заменяет его
    ответом; экран дочитывает переписку.

    Отказы тоже становятся сообщением: молчащее «ожидание» навсегда — худший из
    возможных ответов, потому что человек не знает, ждать ему или нет.
    """

    from core.db import get_sessionmaker
    from core.repositories import ai_conversations as conversations_repo
    from core.schemas.ai_conversations import ASSISTANT_UNAVAILABLE, new_message

    from .client import build_ai_client

    sessionmaker = get_sessionmaker()

    text = DOCTOR_TEMPLATE
    sources: list[str] = []
    blocked = True
    limited = False
    no_material = False
    job_id = None
    status = "done"

    with ai_trace.tracing() as trace:
        try:
            async with sessionmaker() as session:
                result = await answer(
                    build_ai_client(),
                    session,
                    requested_by=uuid.UUID(requested_by),
                    patient_id=uuid.UUID(patient_id),
                    question=question,
                )
            text = result.text
            sources = list(result.sources)
            blocked = result.blocked
            no_material = result.no_material
            job_id = result.ai_job_id
        except AiLimitExceeded as error:
            text = str(error)
            limited = True
        except AiError:
            text = ASSISTANT_UNAVAILABLE
            status = "failed"

        async with sessionmaker() as session:
            with trace.step("save"):
                conversation = await conversations_repo.get_for_update(
                    session, uuid.UUID(conversation_id)
                )
                if conversation is None:
                    # Разговор мог исчезнуть вместе с пациентом (`erase_patient`):
                    # дописывать некуда, и это не ошибка.
                    return {"status": "gone"}

                await conversations_repo.replace_message(
                    session,
                    conversation=conversation,
                    message=new_message(
                        seq=reply_seq,
                        role="assistant",
                        text=text,
                        status=status,  # type: ignore[arg-type]
                        blocked=blocked,
                        limited=limited,
                        no_material=no_material,
                        sources=sources,
                        ai_job_id=job_id,
                    ),
                )
                await session.commit()

    outcome: ai_trace.AssistantOutcome
    if limited:
        outcome = "limited"
    elif status == "failed":
        outcome = "failed"
    elif no_material:
        outcome = "no_material"
    elif blocked:
        # The model was called only if a job was opened.
        outcome = "refused_answer" if job_id is not None else "refused_question"
    else:
        outcome = "answered"
    await _store_trace(sessionmaker, trace, outcome=outcome, enqueued=ctx.get("enqueue_time"))

    return {"status": status, "blocked": blocked}


_log = logging.getLogger(__name__)


async def _store_trace(
    sessionmaker: Any,
    trace: ai_trace.Trace,
    *,
    outcome: ai_trace.AssistantOutcome,
    enqueued: object,
) -> None:
    """Write how long each step took (ADR-0094) — after the answer is saved.

    The family already has the answer; a failed write of a timing must not
    turn it into an error, so it is logged and dropped.
    """

    from core.repositories import ai_traces as traces_repo

    try:
        steps = dict(trace.steps)
        worker_ms = trace.elapsed_ms()
        total_ms = worker_ms
        if isinstance(enqueued, datetime):
            # ARQ stamps the moment the API put the task in; the difference to now,
            # minus what the worker spent, is the wait in the queue.
            since_enqueue = round((datetime.now(UTC) - enqueued).total_seconds() * 1000)
            steps["queue"] = max(since_enqueue - worker_ms, 0)
            total_ms = max(since_enqueue, worker_ms)
        async with sessionmaker() as session:
            await traces_repo.add(
                session,
                kind=AiJobKind.ASSISTANT,
                outcome=outcome,
                steps=steps,
                total_ms=total_ms,
                model=trace.model,
            )
            await session.commit()
    except Exception:  # noqa: BLE001 — a timing is never worth a failed answer
        _log.warning("assistant trace was not stored", exc_info=True)
