"""Близкие ребёнка: кто ведёт его дома и кто может закрыть доступ (ADR-0043).

Правило «кто вправе убрать взрослого» живёт здесь одно — и для списка (кнопка
показывается только там, где сервер её примет), и для самой ручки: две копии
однажды разошлись бы, и экран предлагал бы действие, на которое сервер
отвечает 403.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from core.models.enums import UserRole
from core.repositories import access_codes as codes_repo
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUser
from ..errors import ApiError, ErrorCode
from ..schemas import FamilyMemberRead

#: Почему действующий вправе убрать взрослого — пишется в журнал.
RemovalGround = Literal["specialist", "inviter", "self"]

_CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


def removal_ground(
    viewer: CurrentUser, *, member_id: uuid.UUID, inviter_id: uuid.UUID | None
) -> RemovalGround | None:
    """Вправе ли смотрящий закрыть доступ этому взрослому, и на каком основании.

    Три основания, как у ориентиров (MyChart, Apple Health, Family Link):
    - **специалист**, ведущий ребёнка, — он отвечает за то, кто видит его данные;
    - **пригласивший** — «кого позвал, того и убрал»: родитель, отправивший код
      бабушке, сам исправляет ошибку, не дожидаясь приёма;
    - **сам взрослый** — уйти можно всегда.

    Второго родителя, пришедшего по коду врача, бабушка убрать не может: прав
    «хозяина семьи» в системе нет, и иначе любой приглашённый мог бы вытеснить
    того, кто его позвал.
    """

    if viewer.role in _CARE_ROLES:
        return "specialist"
    if viewer.role is not UserRole.PARENT:
        return None
    if member_id == viewer.id:
        return "self"
    if inviter_id == viewer.id:
        return "inviter"
    return None


async def members(
    session: AsyncSession, *, patient_id: uuid.UUID, viewer: CurrentUser
) -> list[FamilyMemberRead]:
    parent_ids = await patients_repo.list_parent_ids(session, patient_id=patient_id)
    result: list[FamilyMemberRead] = []
    for parent_id in parent_ids:
        parent = await users_repo.get(session, parent_id)
        if parent is None:
            continue
        link = await patients_repo.get_parent_link(
            session, parent_id=parent_id, patient_id=patient_id
        )
        inviter_id = link.invited_by if link is not None else None
        inviter = await users_repo.get(session, inviter_id) if inviter_id is not None else None
        result.append(
            FamilyMemberRead(
                id=parent.id,
                full_name=parent.full_name,
                phone=parent.phone,
                email=parent.email,
                invited_by_name=inviter.full_name if inviter is not None else None,
                is_me=parent.id == viewer.id,
                can_remove=removal_ground(viewer, member_id=parent.id, inviter_id=inviter_id)
                is not None,
            )
        )
    return result


async def remove(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    member_id: uuid.UUID,
    actor: CurrentUser,
    ip: str | None,
) -> None:
    """Закрывает взрослому доступ к ребёнку.

    Вместе со связью гаснут его чаты Telegram при этом ребёнке (иначе бот
    продолжал бы писать в дневник) и его ещё не погашенные коды к ребёнку
    (иначе он успел бы позвать кого-то ещё уже после того, как его убрали).
    """

    if actor.channel == "bot":
        raise ApiError(ErrorCode.FORBIDDEN, "Закрыть доступ можно в приложении или в кабинете.")

    link = await patients_repo.get_parent_link(session, parent_id=member_id, patient_id=patient_id)
    if link is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Этого взрослого нет среди близких ребёнка.")

    ground = removal_ground(actor, member_id=member_id, inviter_id=link.invited_by)
    if ground is None:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Закрыть доступ этому взрослому может тот, кто его пригласил, или лечащий врач.",
        )

    await patients_repo.unlink_parent(session, parent_id=member_id, patient_id=patient_id)
    chats = await telegram_repo.revoke_for_parent(
        session, parent_id=member_id, patient_id=patient_id
    )
    codes = await codes_repo.revoke_pending_of(session, patient_id=patient_id, issued_by=member_id)

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="unlink_parent",
        entity="parent_patient",
        entity_id=patient_id,
        ip=ip,
        before={"parent_id": str(member_id)},
        after={"ground": ground, "revoked_chats": len(chats), "revoked_codes": codes},
    )
