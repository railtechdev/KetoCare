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

#: Ключ транзакционной блокировки, под которой идут проверка предохранителей и
#: запись строки.
#:
#: Без неё обе проверки — «прочитали, потом записали»: одновременные задачи
#: воркера читают одну и ту же сумму за день и проходят предохранитель все
#: разом. Блокировка транзакционная: снимается коммитом, отдельного release не
#: требует, и висит ровно на время проверки и вставки.
BUDGET_LOCK_KEY = 0x4B45544F  # «KETO» в ASCII — лишь бы ключ был свой и постоянный


async def lock_budget(session: AsyncSession) -> None:
    """Взять блокировку на время проверки предохранителей и записи строки."""

    await session.execute(select(func.pg_advisory_xact_lock(BUDGET_LOCK_KEY)))


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
    reserved_cost_usd: Decimal | None = None,
) -> AiJob:
    """Завести строку до обращения к модели, заняв под неё деньги.

    До, а не после: вызов может не вернуться вовсе — оборваться по таймауту или
    уронить процесс, — и тогда следа о нём не осталось бы, а деньги за него
    списались бы. Модель записывается сразу: имя берётся из окружения, и по
    журналу должно быть видно, какое именно значение стояло в тот день.

    `reserved_cost_usd` — верхняя оценка стоимости, она же бронь: пока вызов
    идёт, настоящей цены никто не знает, а бюджет считается по этому же полю.
    Без брони одновременные вызовы видели бы нулевой расход, а оборванный не
    попадал бы в бюджет никогда. Настоящая стоимость заменит её в `mark_done`.
    """

    job = AiJob(
        kind=kind,
        status=AiJobStatus.RUNNING,
        requested_by=requested_by,
        patient_id=patient_id,
        input=payload,
        model=model,
        cost_usd=float(reserved_cost_usd) if reserved_cost_usd is not None else None,
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


async def attach_parsed(session: AsyncSession, *, job: AiJob, parsed: dict[str, Any]) -> AiJob:
    """Положить в журнал разобранную структуру рядом с сырым ответом модели.

    Две записи о разном: `text` — что модель сказала, `parsed` — что мы приняли
    после проверки. Расходятся они регулярно (придуманный `product_id`,
    ограда ```json), и по одному сырому тексту потом не понять, что именно
    ушло человеку на подтверждение.

    Отсюда же берётся `meal_logs.parsed` при подтверждении: клиент присылает
    идентификатор задачи, а не структуру, — иначе он мог бы прислать что угодно
    под видом разбора.
    """

    job.output = {**(job.output or {}), "parsed": parsed}
    await session.flush()
    return job


async def mark_confirmed(session: AsyncSession, *, job: AiJob, log_id: uuid.UUID) -> AiJob:
    """Отметить, что разбор уже принят человеком и записан.

    Разбор — одно предположение об одном приёме пищи, и подтверждается оно один
    раз. Без отметки повторный запрос с тем же `ai_job_id` (двойное нажатие,
    повтор запроса, любопытный клиент) создавал бы второй такой же приём пищи —
    и день ребёнка получал бы лишние жиры, которых не было.
    """

    job.output = {**(job.output or {}), "confirmed_log_id": str(log_id)}
    await session.flush()
    return job


async def list_stuck(session: AsyncSession, *, older_than: datetime) -> list[AiJob]:
    """Вызовы, застрявшие в `RUNNING`.

    Процесс воркера может умереть посреди обращения, и тогда строка остаётся
    «выполняется» навсегда: бронь под неё висит в бюджете, а по журналу не
    видно, чем дело кончилось. Уборщик закрывает такие строки как неудачные,
    бронь при этом остаётся потраченной — деньги-то ушли.
    """

    return list(
        await session.scalars(
            select(AiJob).where(
                AiJob.status == AiJobStatus.RUNNING,
                AiJob.created_at < older_than,
            )
        )
    )


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
