"""Settings the administrator changes from the cabinet (ADR-0080).

One row per setting. The value is JSON so a setting may be a number, a switch or
a small object (a task group); its shape is checked by the registry in
`core.app_settings`, not by the table — a column per setting would turn every
new setting into a migration.

The environment stays the fallback: an empty table means the stand runs exactly
as it did before the table existed.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UpdatedAtMixin


class AppSetting(Base, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    #: A secret is stored encrypted (`core.secret_box`), never in the clear.
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
