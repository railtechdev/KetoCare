"""ИИ и служебные таблицы (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import (
    AiConversationChannel,
    AiJobKind,
    AiJobStatus,
    ReportJobStatus,
    pg_enum,
)


class AiJob(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "ai_jobs"

    kind: Mapped[AiJobKind] = mapped_column(pg_enum(AiJobKind, "ai_job_kind"), nullable=False)
    status: Mapped[AiJobStatus] = mapped_column(
        pg_enum(AiJobStatus, "ai_job_status"), nullable=False, default=AiJobStatus.QUEUED
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id")
    )
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    model: Mapped[str | None] = mapped_column(String(128))
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(8, 4))
    error: Mapped[str | None]
    finished_at: Mapped[datetime | None]


class AiConversation(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "ai_conversations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id")
    )
    channel: Mapped[AiConversationChannel] = mapped_column(
        pg_enum(AiConversationChannel, "ai_conversation_channel"), nullable=False
    )
    messages: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)


class DoctorSummary(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "doctor_summaries"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    period_start: Mapped[date] = mapped_column(nullable=False)
    period_end: Mapped[date] = mapped_column(nullable=False)
    draft_md: Mapped[str] = mapped_column(nullable=False)
    approved_md: Mapped[str | None]
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    ai_job_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("ai_jobs.id"), nullable=False
    )


class AuditLog(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "audit_log"

    user_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(INET)


class ReportJob(Base, UUIDPkMixin, CreatedAtMixin):
    """Задача сборки PDF-отчёта (раздел 5.3 ТЗ: ручка возвращает job id, дальше поллинг).

    Раздел 4.2 ТЗ таблицы под это не предусматривает, а состояние задачи держать
    негде: ARQ хранит его в Redis, который эфемерен, а по идентификатору задачи
    нужно ещё и проверить право скачивать файл — это клинические данные. Плюс
    ссылка на файл живёт ограниченное время, и срок надо где-то помнить.
    Расхождение с разделом 4.2 зафиксировано в docs/adr/0008-report-jobs.md.
    """

    __tablename__ = "report_jobs"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[ReportJobStatus] = mapped_column(
        pg_enum(ReportJobStatus, "report_job_status"),
        nullable=False,
        default=ReportJobStatus.QUEUED,
    )
    # Имя файла в томе отчётов, а не путь: путь задаётся настройкой, и файл,
    # собранный на одной машине, не должен ссылаться на её каталоги.
    file_name: Mapped[str | None] = mapped_column(String(255))
    error: Mapped[str | None]
    expires_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
