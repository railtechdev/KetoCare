"""knowledge base articles in the cabinet

Revision ID: 518ab0d11733
Revises: da7d961e5eb0
Create Date: 2026-11-20 22:09:18.488360

Статьи базы знаний помощника переезжают из файлов репозитория в кабинет (ADR-0093):

- `kb_articles` — статья с постоянным именем (`slug`), видом, происхождением
  (встроенная из выпуска или заведённая в кабинете) и живой редакцией;
- `kb_article_versions` — редакции; опубликованная не меняется и не удаляется
  (запрет держит модель, как у назначений);
- `kb_chunks` получает ссылку на статью и редакцию. Индекс производен, поэтому
  прежние строки удаляются: шаг выката сразу после миграций
  (`core.tools.index_knowledge_base`) переносит статьи в таблицы и собирает
  индекс заново. Несколько секунд между двумя шагами помощник отвечает
  «материалов не нашлось» — это цена того, что кусок без статьи невозможен.

Ссылка статьи на живую редакцию и ссылка редакции на статью образуют цикл, поэтому
внешний ключ `live_version_id` ставится отдельно, после обеих таблиц.

Откат удаляет обе таблицы вместе со всем, что написано в кабинете, и снова
очищает индекс — его пересоберёт прежний индексатор из файлов.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "518ab0d11733"
down_revision: str | None = "da7d961e5eb0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    op.create_table(
        "kb_articles",
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("hidden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("live_version_id", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("NOT hidden OR origin = 'builtin'", name="kb_articles_hidden_builtin"),
        sa.CheckConstraint("kind IN ('clinical', 'product')", name="kb_articles_kind_known"),
        sa.CheckConstraint(
            "origin = 'cabinet' OR kind = 'product'", name="kb_articles_builtin_is_product"
        ),
        sa.CheckConstraint("origin IN ('builtin', 'cabinet')", name="kb_articles_origin_known"),
        sa.CheckConstraint(
            "status <> 'published' OR live_version_id IS NOT NULL",
            name="kb_articles_published_is_live",
        ),
        sa.CheckConstraint(
            "status <> 'withdrawn' OR live_version_id IS NULL",
            name="kb_articles_withdrawn_is_not_live",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'review', 'published', 'withdrawn')",
            name="kb_articles_status_known",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_table(
        "kb_article_versions",
        sa.Column("article_id", sa.UUID(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body_md", sa.Text(), nullable=False),
        sa.Column("sources", sa.Text(), nullable=True),
        sa.Column("author_id", sa.UUID(), nullable=True),
        sa.Column("author_label", sa.String(length=128), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.UUID(), nullable=True),
        sa.Column("approver_label", sa.String(length=128), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_by", sa.UUID(), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("return_comment", sa.Text(), nullable=True),
        sa.Column("source_file_name", sa.String(length=512), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "approved_at IS NULL OR reviewed_by IS NOT NULL OR approver_label IS NOT NULL",
            name="kb_article_versions_approver_named",
        ),
        sa.CheckConstraint(
            "author_id IS NOT NULL OR author_label IS NOT NULL",
            name="kb_article_versions_author_named",
        ),
        sa.ForeignKeyConstraint(["article_id"], ["kb_articles.id"]),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["returned_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("article_id", "number", name="uq_kb_article_versions_number"),
    )
    op.create_index(
        op.f("ix_kb_article_versions_article_id"),
        "kb_article_versions",
        ["article_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_kb_articles_live_version",
        "kb_articles",
        "kb_article_versions",
        ["live_version_id"],
        ["id"],
    )

    # The index is derived: its old rows have no article to point at, and the
    # deploy step right after the migrations rebuilds it from the tables.
    op.execute(sa.text("DELETE FROM kb_chunks"))
    op.add_column("kb_chunks", sa.Column("article_id", sa.UUID(), nullable=False))
    op.add_column("kb_chunks", sa.Column("version_id", sa.UUID(), nullable=False))
    op.create_index(op.f("ix_kb_chunks_article_id"), "kb_chunks", ["article_id"], unique=False)
    op.create_foreign_key(
        "fk_kb_chunks_version",
        "kb_chunks",
        "kb_article_versions",
        ["version_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_kb_chunks_article",
        "kb_chunks",
        "kb_articles",
        ["article_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM kb_chunks"))
    op.drop_constraint("fk_kb_chunks_article", "kb_chunks", type_="foreignkey")
    op.drop_constraint("fk_kb_chunks_version", "kb_chunks", type_="foreignkey")
    op.drop_index(op.f("ix_kb_chunks_article_id"), table_name="kb_chunks")
    op.drop_column("kb_chunks", "version_id")
    op.drop_column("kb_chunks", "article_id")
    op.drop_constraint("fk_kb_articles_live_version", "kb_articles", type_="foreignkey")
    op.drop_index(op.f("ix_kb_article_versions_article_id"), table_name="kb_article_versions")
    op.drop_table("kb_article_versions")
    op.drop_table("kb_articles")
