"""«Напомнить семье» — специалист просит семью отметить дневник (ADR-0046).

Флаг «семья молчит N дней» заканчивался констатацией: у семьи, пришедшей через
Telegram, нет ни телефона, ни почты, и связаться с ней врачу было нечем. Канал
у неё есть — бот, — и просьба уходит туда.

Что уходит семье, решено границей G6 аудита блокеров: имена взрослых — да,
параметры назначения — нет (раздел 7.5 ТЗ). Поэтому сюда не передаётся ничего
о ребёнке — ни имени, ни чисел; текст собирает воркер из имени и роли того, кто
просит.

Предел — одна просьба на ребёнка в сутки, кто бы из специалистов ни нажал:
семья слышит одно напоминание, а не по одному от каждого, кто её ведёт.
Просьба, которую некому доставить (ни одного живого чата), предела не тратит и
в журнал не пишется: ничего не случилось. Врач в этом случае получает контакты
семьи — если они есть.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from core.repositories import audit as audit_repo
from core.repositories import family_nudges as nudges_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo
from core.repositories import therapy as therapy_repo
from core.repositories import users as users_repo

from .. import after_commit
from ..deps.auth import CurrentUser
from ..errors import ApiError, ErrorCode
from ..schemas import FamilyContact, FamilyNudgeRead

#: Не чаще раза в сутки на ребёнка.
NUDGE_INTERVAL = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(UTC)


async def nudge(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    actor: CurrentUser,
    ip: str | None,
) -> FamilyNudgeRead:
    await nudges_repo.lock_patient(session, patient_id)

    # Терапия завершена — просить семью отмечать дневник больше незачем
    # (вопрос 18, ADR-0050). Отказ, а не молчаливый ноль: врач нажал кнопку и
    # должен узнать, почему сообщение не ушло.
    if await therapy_repo.ended_on(session, patient_id=patient_id) is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Терапия у этого ребёнка завершена — напоминание семье не отправляется.",
            details={"reason": "therapy_ended"},
        )

    now = _now()
    previous = await nudges_repo.last_since(
        session, patient_id=patient_id, since=now - NUDGE_INTERVAL
    )
    if previous is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Семье уже напоминали за последние сутки. Повторить можно позже.",
            details={
                "reason": "nudged_recently",
                "previous_at": previous.created_at.isoformat(),
                "next_at": (previous.created_at + NUDGE_INTERVAL).isoformat(),
            },
        )

    links = await telegram_repo.list_links_for_patient(session, patient_id)
    chats = {link.chat_id for link in links if link.revoked_at is None}
    if not chats:
        return FamilyNudgeRead(
            recipients=0, sent_at=None, contacts=await _contacts(session, patient_id)
        )

    specialist = await users_repo.get(session, actor.id)
    if specialist is None:  # pragma: no cover — токен живой, учётка есть
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись не найдена.")

    record = await nudges_repo.create(
        session,
        patient_id=patient_id,
        requested_by=actor.id,
        recipients=len(chats),
        created_at=now,
    )
    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="family_nudge",
        entity="patients",
        entity_id=patient_id,
        ip=ip,
        after={"recipients": len(chats)},
    )
    # После коммита: откатившийся запрос не должен оставить семье сообщение
    # о просьбе, которой в базе нет, — и наоборот, не тратить предел молча.
    after_commit.defer(
        session,
        "notify_family_nudge",
        str(patient_id),
        specialist.full_name,
        specialist.role.value,
    )
    return FamilyNudgeRead(recipients=len(chats), sent_at=record.created_at, contacts=[])


async def _contacts(session: AsyncSession, patient_id: uuid.UUID) -> list[FamilyContact]:
    """Телефон и почта взрослых семьи — только тех, у кого есть хоть что-то."""

    result: list[FamilyContact] = []
    for parent_id in await patients_repo.list_parent_ids(session, patient_id=patient_id):
        parent = await users_repo.get(session, parent_id)
        if parent is None or (parent.phone is None and parent.email is None):
            continue
        result.append(
            FamilyContact(full_name=parent.full_name, phone=parent.phone, email=parent.email)
        )
    return result
