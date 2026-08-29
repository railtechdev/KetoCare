"""Клиника (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import TIMESTAMP, ForeignKey, Integer, Numeric, String, event, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UpdatedAtMixin, UUIDPkMixin


class MedicalProfile(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "medical_profiles"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), unique=True, nullable=False
    )
    diagnosis: Mapped[str | None]
    epilepsy_type: Mapped[str | None]
    onset_age_months: Mapped[int | None] = mapped_column(Integer)
    genetics: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB
    )  # {gene, variant, interpretation}
    comorbidities: Mapped[str | None]


class Prescription(Base, UUIDPkMixin):
    """Append-only (правило 2, CLAUDE.md): изменение назначения — новая строка,
    UPDATE/DELETE запрещены на уровне репозитория."""

    __tablename__ = "prescriptions"

    # НЕ CreatedAtMixin: там server_default=now(), а now() в PostgreSQL — это время
    # НАЧАЛА ТРАНЗАКЦИИ, одинаковое для всех строк, вставленных в одной транзакции.
    # Активное назначение определяется как "последнее по created_at" (раздел 4.2 ТЗ),
    # то есть при совпадении меток порядок недетерминирован — а это ratio, по которому
    # семья кормит ребёнка. clock_timestamp() возвращает реальное время на момент
    # вставки строки и различается даже внутри одной транзакции.
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("clock_timestamp()"), nullable=False
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    ratio: Mapped[float] = mapped_column(Numeric(3, 1), nullable=False)
    kcal_per_day: Mapped[int] = mapped_column(Integer, nullable=False)
    protein_g: Mapped[float] = mapped_column(Numeric(6, 1), nullable=False)
    carbs_limit_g: Mapped[float] = mapped_column(Numeric(6, 1), nullable=False)
    meals_per_day: Mapped[int] = mapped_column(Integer, nullable=False)
    restrictions: Mapped[str | None]
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    effective_from: Mapped[date] = mapped_column(nullable=False)


class AppendOnlyViolationError(RuntimeError):
    """Попытка изменить или удалить строку append-only таблицы."""


@event.listens_for(Prescription, "before_update", propagate=True)
def _forbid_prescription_update(_mapper: object, _connection: object, target: Prescription) -> None:
    raise AppendOnlyViolationError(
        "prescriptions — append-only (правило 4 CLAUDE.md): изменение назначения оформляется "
        "новой строкой через repositories.prescriptions.create(), а не UPDATE существующей."
    )


@event.listens_for(Prescription, "before_delete", propagate=True)
def _forbid_prescription_delete(_mapper: object, _connection: object, target: Prescription) -> None:
    raise AppendOnlyViolationError(
        "prescriptions — append-only (правило 4 CLAUDE.md): удаление назначений запрещено."
    )


class Medication(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "medications"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    drug_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dose: Mapped[str] = mapped_column(String(255), nullable=False)
    frequency: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[date] = mapped_column(nullable=False)
    stopped_at: Mapped[date | None]
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


class ClinicalNote(Base, UUIDPkMixin, CreatedAtMixin, SoftDeleteMixin):
    __tablename__ = "clinical_notes"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    text: Mapped[str] = mapped_column(nullable=False)
