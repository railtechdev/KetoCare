import { AsyncSection, Button, Input, RatioBadge, Section } from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { type Recipe, useRecipe, useRecipeSearch } from "./useRecipes";

/**
 * Рецепты — только чтение (раздел 9 ТЗ).
 *
 * Правка рецепта — работа диетолога в кабинете: по опубликованному рецепту
 * кормят не одного ребёнка, и менять его с телефона между делом нельзя.
 */
export function RecipesScreen() {
  const [openId, setOpenId] = useState<string | null>(null);

  return openId === null ? (
    <RecipeList onOpen={setOpenId} />
  ) : (
    <RecipeCard
      recipeId={openId}
      onBack={() => {
        setOpenId(null);
      }}
    />
  );
}

function RecipeList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 400);
  const recipes = useRecipeSearch(debounced);

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("recipes.title")}</h1>

      <Input
        type="search"
        placeholder={t("recipes.search")}
        aria-label={t("recipes.search")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />

      <AsyncSection
        loading={recipes.isPending}
        skeleton={null}
        error={
          recipes.isError
            ? {
                title: t("recipes.loadError"),
                description:
                  errorMessageOf(recipes.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void recipes.refetch()}
        isEmpty={recipes.data?.length === 0}
        empty={
          <p className="text-muted-foreground">{t("recipes.nothingFound")}</p>
        }
      >
        <ul className="flex flex-col">
          {(recipes.data ?? []).map((recipe) => (
            <li key={recipe.id}>
              <button
                type="button"
                className="flex min-h-(--spacing-touch) w-full items-center gap-field py-2 text-left"
                onClick={() => {
                  onOpen(recipe.id);
                }}
              >
                <span className="flex-1">{recipe.title}</span>
                <RatioBadge ratio={recipe.per_portion?.ratio ?? null} />
              </button>
            </li>
          ))}
        </ul>
      </AsyncSection>
    </main>
  );
}

function RecipeCard({
  recipeId,
  onBack,
}: {
  recipeId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const recipe = useRecipe(recipeId);

  return (
    <main className="flex flex-col gap-block p-block">
      <Button variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {t("recipes.back")}
      </Button>

      <AsyncSection
        loading={recipe.isPending}
        skeleton={null}
        error={
          recipe.isError
            ? {
                title: t("recipes.loadError"),
                description:
                  errorMessageOf(recipe.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void recipe.refetch()}
        isEmpty={false}
        empty={null}
      >
        {recipe.data !== undefined && <RecipeBody recipe={recipe.data} />}
      </AsyncSection>
    </main>
  );
}

function RecipeBody({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const portion = recipe.per_portion;

  return (
    <div className="flex flex-col gap-block">
      <h1 className="text-page-title">{recipe.title}</h1>

      {/* Показатели ПОРЦИИ, а не всего выхода: у плиты считают порцию, и
          подменить одно другим — это ошибка в разы, а не в процентах. */}
      <Section title={t("recipes.perPortion")} density="compact">
        {portion == null ? (
          <p className="text-muted-foreground">{t("recipes.notComputed")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-field">
            <RatioBadge ratio={portion.ratio} />
            <span>{t("recipes.kcal", { kcal: portion.kcal.toFixed(0) })}</span>
            <span className="text-muted-foreground">
              {t("recipes.macros", {
                fat: portion.fat.toFixed(1),
                protein: portion.protein.toFixed(1),
                carbs: portion.carbs.toFixed(1),
              })}
            </span>
          </div>
        )}
        <p className="text-muted-foreground">
          {t("recipes.servings", {
            count: recipe.servings,
            yield: recipe.yield_g,
          })}
        </p>
      </Section>

      <Section title={t("recipes.instructions")} density="compact">
        <p className="whitespace-pre-line">{recipe.instructions}</p>
      </Section>
    </div>
  );
}
