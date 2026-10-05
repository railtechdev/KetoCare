"""Коды доступа семьи к ребёнку (ADR-0040).

Один формат кода на все случаи: первый родитель, второй взрослый, ещё один
чат. Выпускает его ведущий специалист из карты ребёнка или сам родитель.

Срок жизни зависит от назначения кода (ADR-0042): код для другого взрослого
уносят с собой и активируют через день-два, код своего чата вводят тут же, в
соседнем окне.

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
from ..models.enums import AccessCodePurpose

#: Код для другого взрослого живёт неделю: его выдают на приёме (или родитель
#: передаёт его второму взрослому) и активируют дома, часто не в тот же день.
#: Столько же живёт приглашение персонала — и по той же причине.
FAMILY_CODE_TTL = timedelta(days=7)

#: Код, который родитель выпускает себе сам (привязать ещё один чат), живёт
#: столько же, сколько прежний код привязки Telegram: он вводится сразу, и
#: растягивать его незачем.
OWN_CHAT_CODE_TTL = timedelta(minutes=15)

#: Длина задана схемой: `access_codes.code` — String(8).
CODE_LENGTH = 8

#: Алфавит без символов, которые путаются при чтении с экрана и при диктовке:
#: 0/O, 1/I/L. Тот же, что у кодов привязки, — родитель переписывает код руками,
#: и каждая опечатка тратит живую попытку.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_code() -> str:
    """`secrets.choice`, а не `random`: код — это доступ к данным ребёнка."""

    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def ttl_for(purpose: AccessCodePurpose) -> timedelta:
    """Срок жизни по назначению кода — ADR-0042 (прежде — по роли, ADR-0040).

    Выбор живёт здесь, а не в роутере: иначе он однажды разойдётся между
    ручками, и код на неделю окажется там, где его вводят в соседнем окне.
    """

    return OWN_CHAT_CODE_TTL if purpose is AccessCodePurpose.OWN_CHAT else FAMILY_CODE_TTL


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    issued_by: uuid.UUID,
    purpose: AccessCodePurpose,
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
        purpose=purpose,
        expires_at=datetime.now(UTC) + ttl_for(purpose),
    )
    session.add(code)
    await session.flush()
    return code


#: Буквы кириллицы, которые на экране неотличимы от латинских из алфавита кода.
#: Человек переписывает код с чужого телефона на русской раскладке и набирает
#: «А», а не «A» — отказ в таком случае был бы ошибкой продукта, а не защитой.
#: О, З, Ч и прочие сюда не входят: их латинских двойников в алфавите нет.
_LOOKALIKES = str.maketrans("АВЕКМНРСТУХ", "ABEKMHPCTYX")


def normalize_code(code: str) -> str:
    """Приводит набранный человеком код к виду, в котором он хранится.

    Регистр — к верхнему, пробелы и дефисы — прочь (код диктуют и записывают
    группами «ABCD EFGH»), кириллические двойники — к латинице.
    """

    cleaned = "".join(ch for ch in code if not ch.isspace() and ch != "-")
    return cleaned.upper().translate(_LOOKALIKES)


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
            AccessCode.code == normalize_code(code),
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
            AccessCode.code == normalize_code(code),
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


async def revoke_pending_of(
    session: AsyncSession, *, patient_id: uuid.UUID, issued_by: uuid.UUID
) -> int:
    """Гасит непогашенные коды, выданные этим человеком этому ребёнку.

    Нужна там, где специалиста снимают с пациента: активация такого кода и так
    отказывает (выдавший больше не ведёт ребёнка), но в журнале карты он
    оставался «Действует» — и новый ведущий врач не выдавал свой, видя живой
    чужой код. Гасим сразу, чтобы журнал говорил правду без дополнительных
    запросов.
    """

    now = datetime.now(UTC)
    stmt = (
        update(AccessCode)
        .where(
            AccessCode.patient_id == patient_id,
            AccessCode.issued_by == issued_by,
            AccessCode.used_at.is_(None),
            AccessCode.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .returning(AccessCode.code)
    )
    result = await session.execute(stmt)
    return len(result.scalars().all())


async def get(session: AsyncSession, code: str) -> AccessCode | None:
    return await session.get(AccessCode, normalize_code(code))


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
