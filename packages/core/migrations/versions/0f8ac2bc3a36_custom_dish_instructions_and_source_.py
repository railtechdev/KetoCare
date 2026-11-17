"""custom dish instructions and source recipe

A child's dish fitted from a library recipe kept the composition and lost the
cooking steps, so the printed card told a family or a cook what to weigh and
not how to cook it (dietitian, 17.11.2026; ADR-0088).

Dishes saved before this revision carry no link to their recipe. The fitting
sheet names a dish after its recipe, so a dish whose title matches exactly one
recipe gets that recipe's steps and link. A title matching no recipe, or
several, is left alone: guessing between two recipes would print the wrong
steps.

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
        WITH unique_titles AS (
            SELECT lower(btrim(title)) AS key, (array_agg(id))[1] AS recipe_id
            FROM recipes
            GROUP BY lower(btrim(title))
            HAVING count(*) = 1
        )
        UPDATE custom_dishes AS dish
        SET source_recipe_id = recipe.id,
            instructions = NULLIF(btrim(recipe.instructions), '')
        FROM unique_titles
        JOIN recipes AS recipe ON recipe.id = unique_titles.recipe_id
        WHERE lower(btrim(dish.title)) = unique_titles.key
          AND dish.source_recipe_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "custom_dishes", type_="foreignkey")
    op.drop_column("custom_dishes", "source_recipe_id")
    op.drop_column("custom_dishes", "instructions")
