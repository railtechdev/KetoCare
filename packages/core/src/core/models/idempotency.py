"""Ключи повторной отправки записей (ADR-0035).

Клиент присылает `Idempotency-Key` с записью; сервер запоминает, какой ответ
получил запрос с этим ключом, и повтор того же запроса — например, после
потерянного ответа — получает тот же ответ, а не вторую запись.

Таблица техническая, а не клиническая: ключ действует сутки, а строку снимает
ежечасная уборка — дольше 25 часов она не лежит. Но ответ содержит данные ребёнка, поэтому у строки есть `patient_id` —
по нему `erase_patient` стирает её вместе с остальными данными пациента.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UUIDPkMixin


class IdempotencyKey(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "idempotency_keys"
    __table_args__ = (
        # Ключ уникален в пределах пользователя: у двух людей случайно совпавшие
        # ключи не должны отдавать друг другу чужие ответы.
        UniqueConstraint("user_id", "key", name="uq_idempotency_keys_user_key"),
        Index("ix_idempotency_keys_patient_id", "patient_id"),
        Index("ix_idempotency_keys_created_at", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    #: sha256 метода, пути и тела: тот же ключ с другим запросом — ошибка клиента.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=True
    )
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
