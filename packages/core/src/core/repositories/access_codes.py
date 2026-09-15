"""Коды доступа семьи к ребёнку (ADR-0040).

Один вид кода на все случаи: первый родитель, второй родитель, ещё один чат.
Выпускает его специалист из карты ребёнка — или, начиная с этапа Б плана, сам
родитель, чтобы привязать ещё одно устройство.

Срок жизни зависит от того, кто выдал, и это не настройка, а разное назначение:
код специалиста уносят с приёма и активируют дома через день-два, код родителя
вводят тут же, в соседнем окне.

Формат кода общий с `link_codes` — те же восемь знаков и тот же алфавит без
похожих символов: человек не должен различать «коды разных видов», их и не
должно быть видно снаружи.
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AccessCode
from ..models.enums import UserRole

#: Код специалиста живёт неделю: его выдают на приёме и активируют дома, часто
#: не в тот же день. Столько же живёт приглашение персонала — и по той же
#: причине.
SPECIALIST_CODE_TTL = timedelta(days=7)

#: Код, который родитель выпускает себе сам (привязать ещё один чат), живёт
#: столько же, сколько сегодняшний код привязки Telegram: он вводится сразу, и
#: растягивать его незачем.
PARENT_CODE_TTL = timedelta(minutes=15)

#: Длина задана схемой: `access_codes.code` — String(8).
CODE_LENGTH = 8

#: Алфавит без символов, которые путаются при чтении с экрана и при диктовке:
#: 0/O, 1/I/L. Тот же, что у кодов привязки, — родитель переписывает код руками,
#: и каждая опечатка тратит живую попытку.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_code() -> str:
    """`secrets.choice`, а не `random`: код — это доступ к данным ребёнка."""

    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def ttl_for(role: UserRole) -> timedelta:
    """Срок жизни по роли выдавшего — решение 5 ADR-0040.

    Выбор живёт здесь, а не в роутере: иначе он однажды разойдётся между ручкой
    специалиста и ручкой родителя, и код на неделю окажется там, где его вводят
    в соседнем окне.
    """

    return PARENT_CODE_TTL if role is UserRole.PARENT else SPECIALIST_CODE_TTL


async def create(
    session: AsyncSession, *, patient_id: uuid.UUID, issued_by: uuid.UUID, role: UserRole
) -> AccessCode:
    """Выпускает код.

    Коллизия по PK возможна, но исчезающе редка (31^8 ≈ 8.5e11 против считанных
    живых кодов), а всплывает она как IntegrityError на flush — то есть
    отработанной ошибкой, а не порчей чужой строки.
    """

    code = AccessCode(
        code=generate_code(),
        patient_id=patient_id,
        issued_by=issued_by,
        expires_at=datetime.now(UTC) + ttl_for(role),
    )
    session.add(code)
    await session.flush()
    return code


async def claim(session: AsyncSession, code: str) -> AccessCode | None:
    """Атомарно гасит код и возвращает его; `None` — код не годен.

    Проверка «не погашен, не отозван, не истёк» и сама отметка — один UPDATE,
    как в `invitations.claim`. Раздельные get + update допускали бы гонку: два
    одновременных `/start <код>` из разных чатов оба прошли бы проверку и
    создали две привязки на один код.

    Регистр приводится к верхнему: алфавит генерации — заглавные и цифры, а код
    набирают руками с экрана. Отказ человеку, набравшему тот же код строчными, —
    ошибка продукта, а не защита.
    """

    now = datetime.now(UTC)
    stmt = (
        update(AccessCode)
        .where(
            AccessCode.code == code.strip().upper(),
            AccessCode.used_at.is_(None),
            AccessCode.revoked_at.is_(None),
            AccessCode.expires_at > now,
        )
        .values(used_at=now)
        .returning(AccessCode)
    )
    result = await session.execute(stmt)
    claimed: AccessCode | None = result.scalar_one_or_none()
    return claimed


async def release(session: AsyncSession, *, code: str) -> None:
    """Возвращает код в обращение: отметка о погашении снимается.

    Нужна там, где погашение уже произошло, а активация отказала по причине, в
    которой семья не виновата: выдавшего сняли с пациента, чат занят другим
    ребёнком. Сжечь код в этом случае значит оставить семью без доступа из-за
    чужого действия, и врачу пришлось бы выдавать новый.
    """

    await session.execute(
        update(AccessCode).where(AccessCode.code == code).values(used_at=None, used_by=None)
    )


async def mark_used_by(session: AsyncSession, *, code: str, user_id: uuid.UUID) -> None:
    """Дописывает, кому именно достался доступ.

    Отдельным шагом после `claim`: учётной записи в момент погашения может ещё
    не существовать — по коду из бота она и создаётся.
    """

    await session.execute(update(AccessCode).where(AccessCode.code == code).values(used_by=user_id))


async def revoke(session: AsyncSession, *, code: str, patient_id: uuid.UUID) -> AccessCode | None:
    """Отзывает непогашенный код. `None` — отзывать нечего.

    `patient_id` в условии, а не только код: ручка отзыва живёт внутри карты
    ребёнка, и код чужого ребёнка через неё не должен гаситься даже при точном
    попадании в восьмизначную строку.
    """

    now = datetime.now(UTC)
    stmt = (
        update(AccessCode)
        .where(
            AccessCode.code == code.strip().upper(),
            AccessCode.patient_id == patient_id,
            AccessCode.used_at.is_(None),
            AccessCode.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .returning(AccessCode)
    )
    result = await session.execute(stmt)
    revoked: AccessCode | None = result.scalar_one_or_none()
    return revoked


async def get(session: AsyncSession, code: str) -> AccessCode | None:
    return await session.get(AccessCode, code.strip().upper())


async def list_for_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> Sequence[AccessCode]:
    """Журнал кодов ребёнка — все, включая погашенные и отозванные.

    Карта показывает не «действующие коды», а историю выдачи доступа: кто выдал,
    кому достался, что отозвали. Без погашенных строк на вопрос «кто дал доступ
    этому взрослому» ответить было бы нечем.
    """

    stmt = (
        select(AccessCode)
        .where(AccessCode.patient_id == patient_id)
        .order_by(AccessCode.created_at.desc())
    )
    result = await session.execute(stmt)
    return result.scalars().all()
