"""custom dish instructions and source recipe

A child's dish fitted from a library recipe kept the composition and lost the
cooking steps, so the printed card told a family or a cook what to weigh and
not how to cook it (dietitian, 17.11.2026; ADR-0088).

Dishes saved before this revision carry no link to their recipe. The fitting
sheet names a dish after its recipe and changes grams, not products, so a dish
gets a recipe's steps and link only when its title matches exactly one
published recipe and its products are exactly that recipe's. Drafts are never
matched: fitting refuses them, and a family must not read a draft's steps.
Anything else is left alone — wrong steps on a cook's sheet are worse than
none.

Revision ID: 0f8ac2bc3a36
Revises: 3dda4ca27efc
Create Date: 2026-11-17 20:14:02.622635

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0f8ac2bc3a36"
down_revision: str | None = "3dda4ca27efc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FK_NAME = "custom_dishes_source_recipe_id_fkey"


def upgrade() -> None:
    op.add_column("custom_dishes", sa.Column("instructions", sa.Text(), nullable=True))
    op.add_column("custom_dishes", sa.Column("source_recipe_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        FK_NAME,
        "custom_dishes",
        "recipes",
        ["source_recipe_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        WITH candidates AS (
            SELECT lower(btrim(recipe.title)) AS key,
                   recipe.id,
                   recipe.instructions,
                   ARRAY(
                       SELECT DISTINCT line.product_id
                       FROM recipe_ingredients AS line
                       WHERE line.recipe_id = recipe.id
                       ORDER BY 1
                   ) AS products
            FROM recipes AS recipe
            WHERE recipe.status = 'published'
        ),
        unique_titles AS (
            SELECT key FROM candidates GROUP BY key HAVING count(*) = 1
        )
        UPDATE custom_dishes AS dish
        SET source_recipe_id = candidate.id,
            instructions = NULLIF(btrim(candidate.instructions), '')
        FROM candidates AS candidate
        JOIN unique_titles USING (key)
        WHERE lower(btrim(dish.title)) = candidate.key
          AND dish.source_recipe_id IS NULL
          AND candidate.products = ARRAY(
              SELECT DISTINCT (line ->> 'product_id')::uuid
              FROM jsonb_array_elements(dish.ingredients) AS line
              ORDER BY 1
          )
        """
    )


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "custom_dishes", type_="foreignkey")
    op.drop_column("custom_dishes", "source_recipe_id")
    op.drop_column("custom_dishes", "instructions")
