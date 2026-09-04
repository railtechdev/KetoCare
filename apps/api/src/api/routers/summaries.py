"""`/patients/{id}/summaries` — AI-сводка для врача (раздел 10.5 ТЗ, п. 21 этапа 4).

Три ручки: заказать (202), прочитать за период, утвердить. Между первой и второй
работает воркер, поэтому состояние живёт в строке `doctor_summaries`, а не в
памяти экрана: каждая сборка — платный вызов модели, и потерянная задача
означала бы второй такой вызов.

**Кто.** Заказывает и утверждает только врач. Диетолог сюда не допущен: раздел
10.5 называет сводку врачебной, а расширение круга — клиническое решение, а не
техническое (вопрос 40 в `docs/medical/OPEN_QUESTIONS.md`). Родитель — тем более
нет: документ написан не для него.

**Утверждение — момент, когда текст модели становится клиническими данными**
(правило 6 CLAUDE.md). Врач присылает текст, который утверждает: правка входит в
подтверждение, а `draft_md` остаётся неизменным навсегда — пара «черновик и
утверждённое» и есть доказательство, что человек был в контуре.

Присланный текст проверяется постфильтром заново. Не из недоверия к врачу:
утверждение может оказаться механическим нажатием, а рекомендация из черновика
уедет в `approved_md`, оттуда в отчёт и в PDF. Собственное суждение врача о
пациенте пишется во вкладке «Заметки», для этого она и есть.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from core import textguard
from core.models import DoctorSummary
from core.models.enums import AiJobStatus, UserRole
from core.repositories import audit as audit_repo
from core.repositories import doctor_summaries as summaries_repo
from core.repositories import patients as patients_repo

from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..ratelimit import AI_RATE_LIMIT, limiter
from ..services import queue as queue_service
from ..services import summaries as summaries_service

router = APIRouter(prefix="/patients/{patient_id}/summaries", tags=["summaries"])

#: Потолок периода. Квартал — естественный интервал контрольного визита, и он же
#: граница, за которой ряды перестают читаться как «динамика» (вопрос 41).
MAX_PERIOD_DAYS = 92

MAX_SUMMARY_CHARS = 20_000


class SummaryCheck(BaseModel):
    """Находка постфильтра. Классы — кодами: русские тексты живут в словарях
    фронтенда (правило 8 CLAUDE.md), и формулировку можно согласовать с
    медкомандой, не трогая бэкенд."""

    kind: str
    rule: str
    fragment: str
    matched: str
    #: Находка, при которой сводку нельзя утвердить.
    hard: bool


class SummaryRead(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    period_start: date
    period_end: date
    status: AiJobStatus
    draft_md: str | None
    approved_md: str | None
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    error: str | None
    checks: list[SummaryCheck] = []
    created_at: datetime


class SummaryApprove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Текст, который утверждается. Может отличаться от черновика — правка и
    #: есть работа врача.
    approved_md: Annotated[str, Field(min_length=1, max_length=MAX_SUMMARY_CHARS)]


def _read(summary: DoctorSummary) -> SummaryRead:
    return SummaryRead(
        id=summary.id,
        patient_id=summary.patient_id,
        period_start=summary.period_start,
        period_end=summary.period_end,
        status=summary.status,
        draft_md=summary.draft_md,
        approved_md=summary.approved_md,
        approved_by=summary.approved_by,
        approved_at=summary.approved_at,
        error=summary.error,
        checks=[SummaryCheck.model_validate(item) for item in (summary.checks or [])],
        created_at=summary.created_at,
    )


def _require_doctor(user: PatientAccessDep) -> None:
    if user.role is not UserRole.DOCTOR:
        # Тот же код, что и у чужого пациента: по ответу нельзя отличить
        # «не твой пациент» от «не твоя роль».
        raise ApiError(ErrorCode.FORBIDDEN, "Сводка доступна лечащему врачу.")


def _check_period(period_from: date, period_to: date) -> None:
    if period_to < period_from:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Конец периода раньше его начала.",
            details={"field": "to"},
        )
    if (period_to - period_from).days + 1 > MAX_PERIOD_DAYS:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Период длиннее {MAX_PERIOD_DAYS} дней; выберите отрезок покороче.",
            details={"field": "to"},
        )


@router.get("", response_model=list[SummaryRead], summary="Сводки за период")
async def list_summaries(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: PatientAccessDep,
    period_from: Annotated[date, Query(alias="from")],
    period_to: Annotated[date, Query(alias="to")],
) -> list[SummaryRead]:
    """Сводки, заказанные ровно за этот период, новые сверху.

    Ровно за этот: сводка за август и сводка за сентябрь — разные документы, и
    предлагать утвердить первую, когда врач смотрит на второй период, значит
    подписывать текст про чужие числа.
    """

    _require_doctor(user)
    _check_period(period_from, period_to)

    rows = await summaries_repo.list_for_period(
        session, patient_id=patient_id, period_start=period_from, period_end=period_to
    )
    return [_read(row) for row in rows]


@router.post("", response_model=SummaryRead, status_code=202, summary="Заказать черновик сводки")
@limiter.limit(AI_RATE_LIMIT)
async def request_summary(
    request: Request,
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: PatientAccessDep,
    period_from: Annotated[date, Query(alias="from")],
    period_to: Annotated[date, Query(alias="to")],
) -> SummaryRead:
    """Собрать ряды и поставить задачу. Черновик появится в той же строке.

    Идемпотентно, пока задача не завершилась: двойное нажатие или перезагрузка
    страницы — это два обращения к smart-модели по кварталу дневника, оплаченных
    из общего дневного бюджета; исчерпав его, замолчал бы и помощник семей.

    Идемпотентность закрывает повтор того же периода, но не перебор соседних —
    поэтому здесь же стоит ограничитель частоты, общий с остальными ИИ-ручками.
    """

    _require_doctor(user)
    _check_period(period_from, period_to)

    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")

    pending = await summaries_repo.find_pending(
        session, patient_id=patient_id, period_start=period_from, period_end=period_to
    )
    if pending is not None:
        return _read(pending)

    payload = await summaries_service.build_summary_input(
        session, patient=patient, period_from=period_from, period_to=period_to
    )
    summary = await summaries_repo.create(
        session,
        patient_id=patient.id,
        requested_by=user.id,
        period_start=period_from,
        period_end=period_to,
    )
    await _audit(
        session,
        user_id=user.id,
        action="ai_summary.request",
        summary=summary,
        after={"from": period_from.isoformat(), "to": period_to.isoformat()},
    )
    await session.commit()

    # Ряды уезжают в задачу готовыми: воркер не собирает их заново, иначе сводка
    # опишет одни числа, а отчёт покажет другие (ADR-0008, ADR-0023).
    try:
        await queue_service.enqueue(
            "doctor_summary", str(summary.id), str(user.id), str(patient.id), payload
        )
    except Exception:  # noqa: BLE001 — недоступная очередь не оставляет строку в «готовится»
        # Строка уже записана: без этой ветки недоступный Redis оставил бы её в
        # `queued` навсегда. `find_pending` возвращал бы её при каждом следующем
        # заказе, экран показывал бы «черновик готовится», и период оказался бы
        # заперт — задачи-то нет и не будет.
        await summaries_repo.mark_failed(
            session, summary.id, error="Очередь недоступна — задача не поставлена."
        )
        await session.commit()
        raise ApiError(
            ErrorCode.INTERNAL, "Не удалось поставить задачу. Попробуйте ещё раз."
        ) from None
    return _read(summary)


@router.post("/{summary_id}/approve", response_model=SummaryRead, summary="Утвердить сводку")
async def approve_summary(
    patient_id: Annotated[uuid.UUID, Path()],
    summary_id: Annotated[uuid.UUID, Path()],
    body: SummaryApprove,
    session: SessionDep,
    user: PatientAccessDep,
) -> SummaryRead:
    """Подтвердить текст. С этого момента он попадает в отчёт, PDF и выгрузку."""

    _require_doctor(user)

    summary = await summaries_repo.get(session, summary_id)
    if summary is None or summary.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Сводка не найдена.")
    if summary.status is not AiJobStatus.DONE or summary.draft_md is None:
        raise ApiError(ErrorCode.CONFLICT, "Черновик ещё не готов.")

    findings = _hard_findings(body.approved_md)
    if findings:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "В тексте остались утверждения, которых в сводке быть не должно. "
            "Уберите их или перенесите во вкладку «Заметки».",
            details={"findings": findings},
        )

    approved = await summaries_repo.approve(
        session,
        summary_id,
        approved_md=body.approved_md,
        approved_by=user.id,
        approved_at=datetime.now(UTC),
    )
    assert approved is not None  # noqa: S101 - строка прочитана выше в этой же сессии
    await _audit(
        session,
        user_id=user.id,
        action="ai_summary.approve",
        summary=approved,
        # Текста сводки в журнале нет: это клинические данные, а журнал читает
        # администратор, которому они недоступны (тот же довод, что у выгрузок
        # в `routers/reports.py`). Достаточно того, что и когда утверждено и
        # что показывал постфильтр.
        after={
            "edited": body.approved_md.strip() != (approved.draft_md or "").strip(),
            "checks": sorted({str(item.get("kind")) for item in (approved.checks or [])}),
        },
    )
    await session.commit()
    return _read(approved)


def _hard_findings(text: str) -> list[dict[str, Any]]:
    """Находки, при которых текст нельзя утвердить.

    Правила общие с воркером (`core.textguard`): он проверяет ими черновик,
    ручка — текст, который врач утверждает. Второй копии правил быть не должно.
    """

    return [finding.as_dict() for finding in textguard.check(text) if finding.hard]


async def _audit(
    session: SessionDep,
    *,
    user_id: uuid.UUID,
    action: str,
    summary: DoctorSummary,
    after: dict[str, Any],
) -> None:
    await audit_repo.write_audit_log(
        session,
        user_id=user_id,
        action=action,
        entity="doctor_summaries",
        entity_id=summary.id,
        before=None,
        after={"patient_id": str(summary.patient_id), **after},
    )
