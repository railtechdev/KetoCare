"""Вложения: фото рецептов и документы пациента (ADR-0004, ADR-0013).

Отдельный модуль, а не часть `content` или клиники: вложение принадлежит и
рецепту, и пациенту, и класть его в один из доменов значило бы назвать один вид
владельца главным.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UUIDPkMixin
from .enums import AttachmentDocKind, AttachmentOwnerKind, pg_enum


class Attachment(Base, UUIDPkMixin, CreatedAtMixin, SoftDeleteMixin):
    """Загруженный файл.

    Одна таблица на два вида владельца (ADR-0004, решение 1): иначе проверки типа
    и размера появились бы в двух местах и разошлись.

    `owner_id` без внешнего ключа — владелец полиморфный (`recipes.id` либо
    `patients.id`), и единого FK быть не может. Существование владельца
    проверяет сервис перед записью; база от висящей ссылки не защищает, и это
    учтено: у рецепта нет мягкого удаления, у пациента нет `deleted_at` вовсе,
    поэтому вложение переживает своего владельца в обоих случаях.

    Исходное имя (`filename`) хранится только для показа и никогда не участвует
    в пути на диске: имя файла на диске генерирует приложение (`stored_name`).
    """

    __tablename__ = "attachments"
    __table_args__ = (
        # Список вложений всегда запрашивается по владельцу.
        Index("ix_attachments_owner", "owner_kind", "owner_id"),
        Index("ix_attachments_uploaded_by", "uploaded_by"),
    )

    owner_kind: Mapped[AttachmentOwnerKind] = mapped_column(
        pg_enum(AttachmentOwnerKind, "attachment_owner_kind"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(nullable=False)
    # Сверка целостности файла на диске, а не запрет дубликатов: один и тот же
    # анализ может быть законно приложен к двум пациентам, а уникальность
    # конфликтовала бы с мягким удалением (ADR-0013, решение 9).
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    # Описание документа. Всё необязательно: семья фотографирует выписку в
    # стационаре, и требовать заполнения формы в этот момент значило бы получить
    # пустую карту (ADR-0013, решение 2). У фото рецепта не заполняется вовсе.
    doc_kind: Mapped[AttachmentDocKind | None] = mapped_column(
        pg_enum(AttachmentDocKind, "attachment_doc_kind"), nullable=True
    )
    #: Дата самого документа, а не загрузки: выписку прикладывают позже события.
    doc_date: Mapped[date | None]
    description: Mapped[str | None] = mapped_column(String(255))
