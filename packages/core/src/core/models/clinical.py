"""Клиника (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import ForeignKey, Integer, Numeric, String
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
    genetics: Mapped[dict | None] = mapped_column(JSONB)  # {gene, variant, interpretation}
    comorbidities: Mapped[str | None]


class Prescription(Base, UUIDPkMixin, CreatedAtMixin):
    """Append-only (правило 2, CLAUDE.md): изменение назначения — новая строка,
    UPDATE/DELETE запрещены на уровне репозитория."""

    __tablename__ = "prescriptions"

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
