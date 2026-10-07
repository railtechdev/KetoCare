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
RemovalGround = Literal["specialist", "inviter", "lead", "self"]

_CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


def removal_ground(
    viewer: CurrentUser,
    *,
    member_id: uuid.UUID,
    inviter_id: uuid.UUID | None,
    viewer_is_lead: bool = False,
    member_invited_by_family: bool = False,
) -> RemovalGround | None:
    """Вправе ли смотрящий закрыть доступ этому взрослому, и на каком основании.

    Четыре основания, как у ориентиров (MyChart, Apple Health, Family Link):
    - **специалист**, ведущий ребёнка, — он отвечает за то, кто видит его данные;
    - **пригласивший** — «кого позвал, того и убрал»: родитель, отправивший код
      бабушке, сам исправляет ошибку, не дожидаясь приёма;
    - **основной родитель** — тот, кого подключил специалист (или кто был при
      ребёнке до кодов), убирает любого, кого позвала семья. Это организатор
      семьи у Family Link: без него мама, подключённая врачом, получала
      уведомление «закройте доступ» о незнакомце, позванном бабушкой, и не
      могла ничего сделать;
    - **сам взрослый** — уйти можно всегда.

    Обратного нет: приглашённый семьёй не убирает основного родителя, а два
    основных — друг друга. Иначе позванный мог бы вытеснить того, кто его позвал.
    """

    if viewer.role in _CARE_ROLES:
        return "specialist"
    if viewer.role is not UserRole.PARENT:
        return None
    if member_id == viewer.id:
        return "self"
    if inviter_id == viewer.id:
        return "inviter"
    if viewer_is_lead and member_invited_by_family:
        return "lead"
    return None


async def _invited_by_family(session: AsyncSession, invited_by: uuid.UUID | None) -> bool:
    """Связь создана кодом родителя (а не специалиста и не до кодов)."""

    if invited_by is None:
        return False
    inviter = await users_repo.get(session, invited_by)
    return inviter is not None and inviter.role is UserRole.PARENT


async def _is_lead(session: AsyncSession, *, viewer: CurrentUser, patient_id: uuid.UUID) -> bool:
    """Смотрящий — основной родитель: его подключила не семья."""

    if viewer.role is not UserRole.PARENT:
        return False
    link = await patients_repo.get_parent_link(session, parent_id=viewer.id, patient_id=patient_id)
    return link is not None and not await _invited_by_family(session, link.invited_by)


#: Отказ «выйти» последнему взрослому. Один текст на ручку и на подсказку.
LAST_ADULT_MESSAGE = (
    "Вы — единственный взрослый с доступом к ребёнку: после выхода дневник вести "
    "будет некому. Сначала пригласите другого взрослого — или попросите лечащего "
    "врача закрыть доступ."
)


def _sole_adult_leaving(ground: RemovalGround | None, adults: int) -> bool:
    """Единственный взрослый уходит сам.

    Ребёнок остался бы без семьи в продукте: дневник, напоминания и бот — всё
    это ведёт взрослый. Уйти так можно было одним нажатием «Выйти», и вернуть
    доступ — только новым кодом с приёма. Специалиста правило не касается: он
    закрывает доступ осознанно (например, не тому человеку) и сам же выдаёт
    новый код.
    """

    return ground == "self" and adults <= 1


async def members(
    session: AsyncSession, *, patient_id: uuid.UUID, viewer: CurrentUser
) -> list[FamilyMemberRead]:
    parent_ids = await patients_repo.list_parent_ids(session, patient_id=patient_id)
    adults = await patients_repo.count_active_adults(session, patient_id=patient_id)
    viewer_is_lead = await _is_lead(session, viewer=viewer, patient_id=patient_id)
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
        ground = removal_ground(
            viewer,
            member_id=parent.id,
            inviter_id=inviter_id,
            viewer_is_lead=viewer_is_lead,
            member_invited_by_family=inviter is not None and inviter.role is UserRole.PARENT,
        )
        result.append(
            FamilyMemberRead(
                id=parent.id,
                full_name=parent.full_name,
                phone=parent.phone,
                email=parent.email,
                invited_by_name=inviter.full_name if inviter is not None else None,
                is_me=parent.id == viewer.id,
                can_remove=ground is not None and not _sole_adult_leaving(ground, adults),
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

    ground = removal_ground(
        actor,
        member_id=member_id,
        inviter_id=link.invited_by,
        viewer_is_lead=await _is_lead(session, viewer=actor, patient_id=patient_id),
        member_invited_by_family=await _invited_by_family(session, link.invited_by),
    )
    if ground is None:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Закрыть доступ этому взрослому может тот, кто его пригласил, основной родитель "
            "или лечащий врач.",
        )

    adults = await patients_repo.count_active_adults(session, patient_id=patient_id, lock=True)
    if _sole_adult_leaving(ground, adults):
        raise ApiError(ErrorCode.CONFLICT, LAST_ADULT_MESSAGE)

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
