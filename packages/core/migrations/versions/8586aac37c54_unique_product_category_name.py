"""Уникальное имя категории продуктов — и сведение уже разъехавшихся.

Категория рождалась побочным эффектом импорта, а сверка имени шла точным
совпадением: файл с колонкой «жиры» заводил вторую категорию рядом с «Жиры».
Разъехавшийся справочник означает, что часть продуктов не находится по фильтру.

Индекс нельзя построить поверх существующих дублей, поэтому миграция сначала
сводит их. Остаётся та из одноимённых, в которой БОЛЬШЕ продуктов: её написание
и есть то, которым пользуются, — а «Жиры» и «жиры» различаются только им. При
равенстве — меньший `sort`, затем меньший идентификатор: порядок детерминирован,
чтобы результат не зависел от того, в каком порядке база вернула строки.

Категория — справочник, а не клинические данные: правило «клиническое не
удаляется физически» сюда не относится, а сами продукты никуда не деваются.

Revision ID: 8586aac37c54
Revises: 2c04bb896cfb
Create Date: 2026-08-31 17:05:12.001233
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8586aac37c54"
down_revision: str | None = "2c04bb896cfb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Продукты уезжают в «главную» категорию своей группы дубликатов…
    op.execute(
        sa.text(
            """
            WITH canonical AS (
                SELECT DISTINCT ON (lower(btrim(c.name_ru)))
                       c.id, lower(btrim(c.name_ru)) AS key
                FROM product_categories AS c
                ORDER BY
                    lower(btrim(c.name_ru)),
                    (SELECT count(*) FROM products p WHERE p.category_id = c.id) DESC,
                    c.sort,
                    c.id
            )
            UPDATE products AS p
            SET category_id = canonical.id
            FROM product_categories AS c
            JOIN canonical ON canonical.key = lower(btrim(c.name_ru))
            WHERE p.category_id = c.id AND c.id <> canonical.id
            """
        )
    )

    # …и только после этого опустевшие дубликаты исчезают.
    op.execute(
        sa.text(
            """
            DELETE FROM product_categories AS c
            USING (
                SELECT DISTINCT ON (lower(btrim(c.name_ru)))
                       c.id, lower(btrim(c.name_ru)) AS key
                FROM product_categories AS c
                ORDER BY
                    lower(btrim(c.name_ru)),
                    (SELECT count(*) FROM products p WHERE p.category_id = c.id) DESC,
                    c.sort,
                    c.id
            ) AS canonical
            WHERE canonical.key = lower(btrim(c.name_ru)) AND c.id <> canonical.id
            """
        )
    )

    op.create_index(
        "uq_product_categories_name_ru_normalized",
        "product_categories",
        [sa.literal_column("lower(btrim(name_ru))")],
        unique=True,
    )


def downgrade() -> None:
    # Сведённые категории обратно не разъезжаются: восстановить, какой продукт
    # в какой из одноимённых строк лежал, уже нечем.
    op.drop_index("uq_product_categories_name_ru_normalized", table_name="product_categories")
