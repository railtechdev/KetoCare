"""Вложения: фото рецептов и документы пациента (ADR-0004, ADR-0013).

Репозиторий отвечает только за строки. Байты пишет и читает сервис API — он же
владеет каталогом: слой данных не должен знать про файловую систему.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Attachment
from ..models.enums import AttachmentDocKind, AttachmentOwnerKind


async def create(
    session: AsyncSession,
    *,
    owner_kind: AttachmentOwnerKind,
    owner_id: uuid.UUID,
    filename: str,
    stored_name: str,
    mime: str,
    size_bytes: int,
    sha256: str,
    uploaded_by: uuid.UUID,
    doc_kind: AttachmentDocKind | None = None,
    doc_date: date | None = None,
    description: str | None = None,
) -> Attachment:
    attachment = Attachment(
        owner_kind=owner_kind,
        owner_id=owner_id,
        filename=filename,
        stored_name=stored_name,
        mime=mime,
        size_bytes=size_bytes,
        sha256=sha256,
        uploaded_by=uploaded_by,
        doc_kind=doc_kind,
        doc_date=doc_date,
        description=description,
    )
    session.add(attachment)
    await session.flush()
    return attachment


async def get(session: AsyncSession, attachment_id: uuid.UUID) -> Attachment | None:
    """Не отдаёт удалённое: мягко удалённое вложение не существует для читателя."""

    stmt = select(Attachment).where(Attachment.id == attachment_id, Attachment.deleted_at.is_(None))
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def list_for_owner(
    session: AsyncSession, *, owner_kind: AttachmentOwnerKind, owner_id: uuid.UUID
) -> list[Attachment]:
    """Вложения владельца, свежие сверху.

    Порядок по дате документа, а не загрузки: выписку прикладывают позже
    события, и список, отсортированный по загрузке, перемешал бы хронологию
    болезни. Документы без даты уходят вниз — о них известно меньше всего.
    """

    stmt = (
        select(Attachment)
        .where(
            Attachment.owner_kind == owner_kind,
            Attachment.owner_id == owner_id,
            Attachment.deleted_at.is_(None),
        )
        .order_by(Attachment.doc_date.desc().nullslast(), Attachment.created_at.desc())
    )
    return list(await session.scalars(stmt))


async def used_bytes(
    session: AsyncSession, *, owner_kind: AttachmentOwnerKind, owner_id: uuid.UUID
) -> int:
    """Сколько байт занимают живые вложения владельца.

    Удалённые не считаются, хотя их байты лежат на диске до уборки (отсрочка
    `ATTACHMENT_PURGE_DAYS`). Иначе удаление документа не освобождало бы место в
    глазах семьи, и упершийся в квоту не смог бы её разгрузить вовсе.
    """

    result = await session.execute(
        select(func.coalesce(func.sum(Attachment.size_bytes), 0)).where(
            Attachment.owner_kind == owner_kind,
            Attachment.owner_id == owner_id,
            Attachment.deleted_at.is_(None),
        )
    )
    return int(result.scalar_one())


async def soft_delete(session: AsyncSession, *, attachment: Attachment) -> None:
    """Мягкое удаление (правило 4).

    Байты остаются на диске, пока их не снимет уборщик — не раньше чем через
    `ATTACHMENT_PURGE_DAYS` дней. Отсрочка нужна ровно затем, чтобы случайное
    удаление выписки можно было отменить руками.
    """

    attachment.deleted_at = datetime.now(UTC)
    await session.flush()


async def list_purgeable(session: AsyncSession, *, before: datetime) -> list[Attachment]:
    """Вложения, у которых пора снять байты с диска.

    Удалённые раньше `before` и ещё не убранные. Строки остаются навсегда: по
    ним видно, что документ был и когда исчез, — это и есть след правила 4.
    """

    stmt = select(Attachment).where(
        Attachment.deleted_at.is_not(None),
        Attachment.deleted_at < before,
        Attachment.purged_at.is_(None),
    )
    return list(await session.scalars(stmt))


async def mark_purged(session: AsyncSession, *, attachments: list[Attachment]) -> None:
    """Отмечает, что байты сняты. Без отметки уборщик каждую ночь заново
    обходил бы все когда-либо удалённые вложения."""

    now = datetime.now(UTC)
    for attachment in attachments:
        attachment.purged_at = now
    await session.flush()
