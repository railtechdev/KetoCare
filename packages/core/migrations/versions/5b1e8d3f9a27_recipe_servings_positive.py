"""порций в рецепте не меньше одной

Revision ID: 5b1e8d3f9a27
Revises: c4a9e2d17b35
Create Date: 2026-09-11 13:20:00.000000

Меню делит состав рецепта на число его порций, и рецепт с нулём порций ронял
сохранение дня: `PUT /patients/{id}/menus` отвечал 500, и семья не могла
составить день целиком. Такие рецепты появлялись из CSV-импорта: он приводил
дробное число порций через `int()` и писал в репозиторий мимо `RecipeWrite`
(`ge=1`), так что «0,5» становилось нулём (найдено ревью #136).

**NOT VALID — намеренно.** Ограничение проверяет новые и изменяемые строки, но не
те, что уже лежат в базе: иначе миграция упала бы на стенде, где такой рецепт
уже есть, и выкат остановился бы. Найти их можно так:

    SELECT id, title FROM recipes WHERE servings < 1 AND deleted_at IS NULL;

Исправляются они формой рецепта (там порций не меньше одной). Пока строка не
исправлена, API отказывает понятным текстом и при добавлении такого рецепта в
меню, и при его публикации. Когда таких строк не останется, ограничение можно
проверить целиком: `ALTER TABLE recipes VALIDATE CONSTRAINT
ck_recipes_servings_positive`.

Автогенерация Alembic CHECK-ограничения не сравнивает, поэтому оно объявлено и в
модели, и здесь — вручную.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b1e8d3f9a27"
down_revision: str | None = "c4a9e2d17b35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_recipes_servings_positive"


def upgrade() -> None:
    op.execute(f"ALTER TABLE recipes ADD CONSTRAINT {CONSTRAINT} CHECK (servings >= 1) NOT VALID")


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT, "recipes", type_="check")
