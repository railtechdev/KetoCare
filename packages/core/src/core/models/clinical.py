"""Клиника (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    event,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import IntakeScale, pg_enum


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
    # Сколько противоэпилептических препаратов ребёнок сменил, диапазоном
    # (ADR-0007). Врачебное поле: семья путает названия и число попыток, а от
    # этого зависит, считается ли эпилепсия фармакорезистентной.
    aed_switch_count_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )


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


class IntakeOption(Base, UUIDPkMixin):
    """Вариант ответа шкалы анкеты регистрации (ADR-0007).

    Один справочник на все шкалы: вид шкалы задаёт `scale`. Формулировки —
    из документа заказчика; три шкалы из пяти к применению как есть непригодны
    (разрывы и пересечения), вопросы 19-21 в docs/medical/OPEN_QUESTIONS.md.
    Правятся админ-ручкой, а не миграцией: состав задаёт медицинская команда.
    """

    __tablename__ = "intake_options"
    __table_args__ = (UniqueConstraint("scale", "code", name="uq_intake_options_scale_code"),)

    scale: Mapped[IntakeScale] = mapped_column(pg_enum(IntakeScale, "intake_scale"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name_ru: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Выведенный из употребления вариант: новым ответам не предлагается, но
    # остаётся в справочнике. Удалить его нельзя — на него ссылаются уже
    # заполненные анкеты, а ответ семьи не должен исчезать вместе со сменой
    # формулировки (правило 4 CLAUDE.md).
    retired: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class AedDrug(Base, UUIDPkMixin):
    """Противоэпилептический препарат (ADR-0007).

    Каноническое имя и синонимы вместо свободной строки: «Летирам»,
    «Леветирацетам» и «Кеппра» — одно и то же вещество, и свободный ввод сделал
    бы записи несравнимыми. Поиск идёт и по синонимам.
    """

    __tablename__ = "aed_drugs"

    name_ru: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    synonyms: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # См. `IntakeOption.retired`: на препарат ссылаются заполненные анкеты.
    retired: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class PatientIntake(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    """Ответы семьи из анкеты регистрации (ADR-0007).

    Отдельная таблица, а не колонки в `medical_profiles`: профиль пишет только
    врач, а это — ответы семьи. Разделение по таблицам выражает право записи
    связью, а не проверкой в каждой ручке (правило 5 CLAUDE.md).

    Одна строка на пациента: анкета заполняется один раз при заведении ребёнка
    и потом уточняется, а не накапливается версиями.
    """

    __tablename__ = "patient_intake"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Дата последнего приступа **на момент анкеты**. Дальше она вычисляется из
    # дневника: хранить её обновляемым полем нельзя — она немедленно разойдётся
    # с записями, а лечение сверяется с записями (ADR-0007).
    last_seizure_on: Mapped[date | None] = mapped_column(Date)

    onset_age_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    seizure_frequency_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    seizure_duration_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    # Кратность приёмов пищи **до терапии**, со слов семьи. Не то же, что
    # `prescriptions.meals_per_day`: там предписание врача, и одно поле на два
    # смысла означало бы, что назначение переписывается ответом родителя.
    meals_per_day_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )

    developmental_delay: Mapped[bool | None] = mapped_column(Boolean)
    meals_regular: Mapped[bool | None] = mapped_column(Boolean)

    # Что ребёнок принимает — со слов семьи, ориентировочно. Точный список с
    # дозами ведёт врач в `medications`: на анкете родитель дозы не знает, а
    # `medications.dose` и `frequency` обязательны и обязательными остаются.
    current_aed_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
