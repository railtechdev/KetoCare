"""Журнал обращений к модели (раздел 10.2 ТЗ).

Строка заводится на КАЖДЫЙ вызов, включая неудачный: по этому журналу считается
дневной бюджет проекта и суточный предел пользователя, а вызов, который стоил
денег и упал, стоил их ровно так же, как успешный. Журнал заодно отвечает на
вопрос «что именно ушло в модель»: в `input` лежит уже псевдонимизированная
нагрузка — та самая, что была отправлена.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AiJob
from ..models.enums import AiJobKind, AiJobStatus


async def get(session: AsyncSession, job_id: uuid.UUID) -> AiJob | None:
    job: AiJob | None = await session.get(AiJob, job_id)
    return job


async def create(
    session: AsyncSession,
    *,
    kind: AiJobKind,
    requested_by: uuid.UUID,
    patient_id: uuid.UUID | None,
    payload: dict[str, Any],
    model: str,
) -> AiJob:
    """Завести строку до обращения к модели.

    До, а не после: вызов может не вернуться вовсе — оборваться по таймауту или
    уронить процесс, — и тогда следа о нём не осталось бы, а деньги за него
    списались бы. Модель записывается сразу: имя берётся из окружения, и по
    журналу должно быть видно, какое именно значение стояло в тот день.
    """

    job = AiJob(
        kind=kind,
        status=AiJobStatus.RUNNING,
        requested_by=requested_by,
        patient_id=patient_id,
        input=payload,
        model=model,
    )
    session.add(job)
    await session.flush()
    return job


async def mark_done(
    session: AsyncSession,
    *,
    job: AiJob,
    output: dict[str, Any],
    tokens_in: int | None,
    tokens_out: int | None,
    cost_usd: Decimal | None,
) -> AiJob:
    job.status = AiJobStatus.DONE
    job.output = output
    job.tokens_in = tokens_in
    job.tokens_out = tokens_out
    job.cost_usd = float(cost_usd) if cost_usd is not None else None
    job.error = None
    job.finished_at = datetime.now(UTC)
    await session.flush()
    return job


async def mark_failed(
    session: AsyncSession,
    *,
    job: AiJob,
    error: str,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    cost_usd: Decimal | None = None,
) -> AiJob:
    """Отметить неудачу — вместе с тем, что успело потратиться.

    Токены записываются и здесь: ответ мог прийти и оказаться негодным (не тот
    формат, отказ модели), и потрачен он был по-настоящему.
    """

    job.status = AiJobStatus.FAILED
    # Текст обрезается: сюда попадает исключение клиента, и трассировка в поле,
    # которое читает человек, ни к чему.
    job.error = error[:500]
    job.tokens_in = tokens_in
    job.tokens_out = tokens_out
    job.cost_usd = float(cost_usd) if cost_usd is not None else None
    job.finished_at = datetime.now(UTC)
    await session.flush()
    return job


async def count_since(
    session: AsyncSession,
    *,
    requested_by: uuid.UUID,
    kinds: tuple[AiJobKind, ...],
    since: datetime,
) -> int:
    """Сколько обращений сделал пользователь с момента `since`.

    Считаются все строки, а не только успешные: иначе предел обходится
    запросами, которые падают у модели, — а они и нагружают, и стоят.
    """

    total = await session.scalar(
        select(func.count())
        .select_from(AiJob)
        .where(
            AiJob.requested_by == requested_by,
            AiJob.kind.in_(kinds),
            AiJob.created_at >= since,
        )
    )
    return int(total or 0)


async def cost_since(session: AsyncSession, *, since: datetime) -> Decimal:
    """Сколько проект потратил с момента `since`, в долларах.

    Строки с неизвестной стоимостью (`cost_usd IS NULL`) в сумму не входят: у
    модели, которой нет в прайс-листе, цена не выдумывается. Дыра в учёте
    видна по журналу — сумма считается только по тому, что действительно
    известно.
    """

    total = await session.scalar(
        select(func.coalesce(func.sum(AiJob.cost_usd), 0))
        .select_from(AiJob)
        .where(AiJob.created_at >= since)
    )
    return Decimal(str(total or 0))
