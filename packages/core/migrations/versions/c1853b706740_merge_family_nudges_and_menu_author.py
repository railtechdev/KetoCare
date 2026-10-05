"""merge family nudges and menu author

Две ветки работ (ADR-0046 «напомнить семье» и ADR-0047 «план составил
специалист») выросли из одной ревизии и шли параллельно. Схему эта ревизия не
меняет — только сводит историю в одну голову.

Revision ID: c1853b706740
Revises: 44141e749dc7, e1f5d3ee60bb
Create Date: 2026-10-05 11:33:36.762245

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "c1853b706740"
down_revision: str | tuple[str, ...] | None = ("44141e749dc7", "e1f5d3ee60bb")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
