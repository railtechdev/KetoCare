"""Вложения: фото рецептов и документы пациента (ADR-0004, ADR-0013).

Репозиторий отвечает только за строки. Байты пишет и читает сервис API — он же
владеет каталогом: слой данных не должен знать про файловую систему.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
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


async def soft_delete(session: AsyncSession, *, attachment: Attachment) -> None:
    """Мягкое удаление (правило 4).

    Байты остаются на диске: уборщика файлов в продукте нет ни для отчётов, ни
    для вложений, и делать вид, что он есть, нельзя. Долг зафиксирован в
    ADR-0013.
    """

    attachment.deleted_at = datetime.now(UTC)
    await session.flush()
