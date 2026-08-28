import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useSession } from "../auth/useSession";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeFiltersPanel } from "./RecipeFiltersPanel";
import { RecipeFormPanel } from "./RecipeFormPanel";
import { RecipeList } from "./RecipeList";
import {
  canEditRecipes,
  EMPTY_RECIPE_FILTERS,
  isRatioRangeInvalid,
  RECIPES_PAGE_SIZE,
  type RecipeFilters,
} from "./types";
import { useRecipeSearch } from "./useRecipes";

type View =
  | { kind: "list" }
  | { kind: "detail"; recipeId: string }
  /** `recipeId: null` — создание рецепта */
  | { kind: "form"; recipeId: string | null };

/**
 * Раздел «Рецепты» (раздел 8.1 ТЗ).
 *
 * Список, карточка и форма живут в одном разделе маршрута: `/app/$section` не
 * знает о вложенных путях, поэтому что показывать, решает состояние экрана.
 */
export function RecipesPage() {
  const { t } = useTranslation("recipes");
  const { session } = useSession();

  // Кнопки правки видят только admin/dietitian (раздел 5.3 ТЗ). Это UX:
  // сами ручки закрыты ролевой проверкой на сервере.
  const canEdit = canEditRecipes(session?.role);

  const [filters, setFilters] = useState<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const [view, setView] = useState<View>({ kind: "list" });

  // Поиск уходит с задержкой: иначе полнотекстовый запрос дёргается на каждой букве.
  const debouncedQuery = useDebouncedValue(filters.q, 300);
  const rangeInvalid = isRatioRangeInvalid(filters);
  const recipes = useRecipeSearch(
    { ...filters, q: debouncedQuery },
    !rangeInvalid,
  );

  function patchFilters(patch: Partial<RecipeFilters>) {
    // Любая смена фильтра возвращает выдачу к первой странице: иначе после
    // «показать ещё» новый фильтр запросил бы сразу сотню карточек.
    setFilters((current) => ({
      ...current,
      ...patch,
      limit: RECIPES_PAGE_SIZE,
    }));
  }

  if (view.kind === "form") {
    return (
      <RecipeFormPanel
        recipeId={view.recipeId}
        onSaved={(recipeId) => setView({ kind: "detail", recipeId })}
        onCancel={() =>
          setView(
            view.recipeId === null
              ? { kind: "list" }
              : { kind: "detail", recipeId: view.recipeId },
          )
        }
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <RecipeDetail
        recipeId={view.recipeId}
        canEdit={canEdit}
        onBack={() => setView({ kind: "list" })}
        onEdit={(recipeId) => setView({ kind: "form", recipeId })}
      />
    );
  }

  const items = recipes.data?.items ?? [];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>
          <p className="mt-1 mb-0 text-muted">{t("intro")}</p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setView({ kind: "form", recipeId: null })}
            className="min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent"
          >
            {t("actions.create")}
          </button>
        )}
      </header>

      <RecipeFiltersPanel
        filters={filters}
        rangeInvalid={rangeInvalid}
        onChange={patchFilters}
        onReset={() => setFilters(EMPTY_RECIPE_FILTERS)}
      />

      {recipes.isError && (
        <FormError>
          {errorMessageOf(recipes.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {recipes.isLoading ? (
        <p role="status" className="text-muted">
          {t("list.loading")}
        </p>
      ) : (
        <RecipeList
          recipes={items}
          total={recipes.data?.total ?? items.length}
          showStatus={canEdit}
          onOpen={(recipeId) => setView({ kind: "detail", recipeId })}
          onShowMore={() =>
            setFilters((current) => ({
              ...current,
              limit: current.limit + RECIPES_PAGE_SIZE,
            }))
          }
        />
      )}
    </section>
  );
}
