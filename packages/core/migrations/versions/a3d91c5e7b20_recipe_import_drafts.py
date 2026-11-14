"""recipe import drafts and product aliases

Revision ID: a3d91c5e7b20
Revises: cf63033fb900
Create Date: 2026-11-14

Загрузка рецептов из файла диетолога как он есть (ADR-0079):

- `recipe_import_drafts` — файл на проверке: его текст по строкам, разобранные
  рецепты и решения проверяющего. Рабочее состояние, не клинические данные;
- `product_aliases` — название из чужого файла, которое специалист однажды
  сопоставил с продуктом справочника: в следующем файле оно уже не спрашивается;
- значение `recipe_import` у вида ИИ-задачи. Состав перечислений автогенерация
  не сравнивает, `ALTER TYPE` рукописный — как в `f739fbebd238`.

Откат убирает обе таблицы: черновики и запомненные соответствия теряются,
заведённые из них рецепты остаются. Строки журнала `ai_jobs` с новым видом
откату мешают — он отказывает, а не переписывает журнал.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a3d91c5e7b20"
down_revision: str | None = "cf63033fb900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS_BEFORE = ("assistant", "parse_meal", "parse_event", "doctor_summary", "content_draft")


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TYPE ai_job_kind ADD VALUE IF NOT EXISTS 'recipe_import' AFTER 'content_draft'"
        )
    )

    op.create_table(
        "recipe_import_drafts",
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("source_lines", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("lines_done", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("failure", sa.String(length=500), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('parsing', 'ready', 'failed')",
            name="recipe_import_drafts_status_known",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_recipe_import_drafts_created_by"),
        "recipe_import_drafts",
        ["created_by"],
        unique=False,
    )

    op.create_table(
        "product_aliases",
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.Column("product_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("alias"),
    )
    op.create_index(
        op.f("ix_product_aliases_product_id"), "product_aliases", ["product_id"], unique=False
    )


def downgrade() -> None:
    bind = op.get_bind()

    used = bind.scalar(sa.text("SELECT count(*) FROM ai_jobs WHERE kind::text = 'recipe_import'"))
    if used:
        raise RuntimeError(
            f"Откат невозможен: в журнале ИИ {used} обращений разбора рецептов. "
            "Журнал не переписывается; сначала решите, что делать с этими строками."
        )

    op.drop_index(op.f("ix_product_aliases_product_id"), table_name="product_aliases")
    op.drop_table("product_aliases")
    op.drop_index(op.f("ix_recipe_import_drafts_created_by"), table_name="recipe_import_drafts")
    op.drop_table("recipe_import_drafts")

    values = ", ".join(f"'{value}'" for value in _KINDS_BEFORE)
    op.execute(sa.text(f"CREATE TYPE ai_job_kind_old AS ENUM ({values})"))
    op.execute(
        sa.text(
            "ALTER TABLE ai_jobs ALTER COLUMN kind "
            "TYPE ai_job_kind_old USING kind::text::ai_job_kind_old"
        )
    )
    op.execute(sa.text("DROP TYPE ai_job_kind"))
    op.execute(sa.text("ALTER TYPE ai_job_kind_old RENAME TO ai_job_kind"))
