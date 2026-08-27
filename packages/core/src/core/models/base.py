"""Базовый declarative-класс и переиспользуемые миксины (раздел 4.1 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import TIMESTAMP, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    # Раздел 4.1 ТЗ: "Везде created_at timestamptz". Любой `Mapped[datetime]` без явного
    # mapped_column-типа получает часовой пояс автоматически — иначе SQLAlchemy по умолчанию
    # маппит datetime на naive TIMESTAMP.
    type_annotation_map = {datetime: TIMESTAMP(timezone=True)}


class UUIDPkMixin:
    """Первичный ключ uuid, генерируется `gen_random_uuid()` (PostgreSQL 13+, встроено)."""

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )


class UpdatedAtMixin:
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SoftDeleteMixin:
    """`deleted_at` — мягкое удаление клинических и дневниковых записей (правило 4, CLAUDE.md)."""

    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
