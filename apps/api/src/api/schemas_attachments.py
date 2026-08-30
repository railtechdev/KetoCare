"""Схемы вложений (ADR-0004, ADR-0013)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from core.models.enums import AttachmentDocKind


class AttachmentRead(BaseModel):
    """Вложение в списке.

    Без `stored_name` и без пути: имя файла на диске — внутренняя деталь, и
    отдавать его наружу значило бы приглашать обращаться к файлу мимо ручки.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    mime: str
    size_bytes: int
    uploaded_by: uuid.UUID
    doc_kind: AttachmentDocKind | None
    doc_date: date | None
    description: str | None
    created_at: datetime


class AttachmentMeta(BaseModel):
    """Описание документа при загрузке.

    Всё необязательно: семья фотографирует выписку в стационаре, и требовать
    заполнения формы в этот момент значило бы получить пустую карту
    (ADR-0013, решение 2).
    """

    doc_kind: AttachmentDocKind | None = None
    doc_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
