"""Сводка для врача: ряды за период → черновик (раздел 10.5 ТЗ, п. 21 этапа 4).

Воронка короче, чем у помощника, потому что опасность другая. Помощник отвечает
семье, и непроверенный ответ до неё доходить не должен — там текст заменяется
шаблоном. Сводку читает врач, и худшее, что можно сделать, — спрятать от него
черновик: он не отличит «модель написала лишнее» от «система сломалась», а
разбирать ложные срабатывания станет нечем.

Поэтому здесь:

1. **Ряды не собираются.** Их передаёт API готовыми — тем же приёмом, что в
   ADR-0008: числа сводки обязаны совпадать с числами отчёта.
2. **Обращение к модели** — через общий клиент: псевдонимизация, журнал
   `ai_jobs`, дневной бюджет (правило 6 CLAUDE.md).
3. **Две проверки черновика.** Лексическая (`summary_guard`) — рекомендации,
   суждения, диагнозы. Числовая (`grounding`) — величины, которых в переданных
   рядах не было.
4. **Черновик сохраняется всегда**, вместе с находками. Клиническими данными он
   не становится: в отчёт попадает только `approved_md` после утверждения
   врачом, и фильтр стоит в единственном месте выборки.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from core.models.enums import AiJobKind
from core.textguard import summary_guard as sguard

from . import grounding
from .client import AiClient, AiError, AiLimitExceeded

#: Потолок ответа. Шесть разделов по одному-двум предложениям — промпт просит
#: именно этого. Больше означало бы, что модель ушла рассказывать своё, а чем
#: длиннее текст, тем меньше шансов, что врач дочитает до находки внизу.
MAX_TOKENS = 2000

#: Класс находки для выдуманного числа. Мягкий: он показывает врачу, какую
#: именно цифру проверить, а запрещать утверждение не должен — число в
#: отредактированном тексте может быть и врачебным (результат анализа с приёма).
UNGROUNDED_KIND = "ungrounded_number"


@dataclass(frozen=True, slots=True)
class Draft:
    text: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    ai_job_id: uuid.UUID | None = None


@lru_cache(maxsize=1)
def prompt() -> str:
    """Системный промпт — файлом (раздел 10.4 ТЗ), меняется отдельным PR."""

    return (Path(__file__).parent / "prompts" / "doctor_summary.md").read_text(encoding="utf-8")


async def summarize(
    client: AiClient,
    *,
    requested_by: uuid.UUID,
    patient_id: uuid.UUID,
    payload: dict[str, Any],
) -> Draft:
    """Черновик сводки по готовым рядам."""

    reply = await client.ask(
        kind=AiJobKind.DOCTOR_SUMMARY,
        requested_by=requested_by,
        patient_id=patient_id,
        system=prompt(),
        payload=payload,
        max_tokens=MAX_TOKENS,
    )

    checks = [finding.as_dict() for finding in sguard.check(reply.text)]
    checks += [
        {
            "kind": UNGROUNDED_KIND,
            "rule": "not_in_payload",
            "fragment": item.fragment,
            "matched": _format(item.value),
            "hard": False,
        }
        for item in grounding.check(reply.text, payload)
    ]
    return Draft(text=reply.text, checks=checks, ai_job_id=reply.job_id)


def _format(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


async def doctor_summary(
    ctx: dict[str, object],
    summary_id: str,
    requested_by: str,
    patient_id: str,
    payload: dict[str, Any],
) -> dict[str, object]:
    """Задача ARQ: собрать черновик сводки и записать его в `doctor_summaries`.

    Отказ тоже становится видимым состоянием (`failed` + причина): молчащее
    «готовится» навсегда — худший из ответов, потому что врач не знает, ждать
    ему или заказывать заново. Та же причина, по которой отказы помощника
    дописываются в переписку сообщением (ADR-0022).
    """

    from core.db import get_sessionmaker
    from core.repositories import doctor_summaries as summaries_repo

    from .client import build_ai_client

    sessionmaker = get_sessionmaker()
    identifier = uuid.UUID(summary_id)

    async with sessionmaker() as session:
        await summaries_repo.mark_running(session, identifier)
        await session.commit()

    try:
        draft = await summarize(
            build_ai_client(),
            requested_by=uuid.UUID(requested_by),
            patient_id=uuid.UUID(patient_id),
            payload=payload,
        )
    except AiLimitExceeded as error:
        await _fail(sessionmaker, identifier, str(error))
        return {"status": "limited"}
    except AiError as error:
        await _fail(
            sessionmaker,
            identifier,
            "Не удалось собрать черновик: модель недоступна. "
            f"Попробуйте позже. ({type(error).__name__})",
        )
        return {"status": "failed"}

    async with sessionmaker() as session:
        saved = await summaries_repo.attach_draft(
            session,
            identifier,
            draft_md=draft.text,
            checks=draft.checks,
            ai_job_id=draft.ai_job_id,
        )
        if saved is None:
            # Строка могла исчезнуть вместе с пациентом (`erase_patient`):
            # записывать некуда, и это не ошибка.
            return {"status": "gone"}
        await session.commit()

    return {"status": "done", "checks": len(draft.checks)}


async def _fail(sessionmaker: Any, summary_id: uuid.UUID, error: str) -> None:
    from core.repositories import doctor_summaries as summaries_repo

    async with sessionmaker() as session:
        await summaries_repo.mark_failed(session, summary_id, error=error)
        await session.commit()
