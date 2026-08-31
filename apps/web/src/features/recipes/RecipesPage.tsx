import { AsyncSection, Button, Tabs, TabsBar, TabsContent } from "@ketocare/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { useSectionTab } from "../../routes/useSectionTab";
import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useSession } from "../auth/useSession";
import { MyDishesPanel } from "../dishes/MyDishesPanel";
import { useSelectedPatient } from "../patients/useSelectedPatient";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeFiltersPanel } from "./RecipeFiltersPanel";
import { RecipeFormPanel } from "./RecipeFormPanel";
import { RecipeList, RecipeListEmpty, RecipeListSkeleton } from "./RecipeList";
import {
  canEditRecipes,
  EMPTY_RECIPE_FILTERS,
  hasActiveFilters,
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
const TABS = ["recipes", "dishes"] as const;

type Tab = (typeof TABS)[number];

export function RecipesPage() {
  const { t } = useTranslation("recipes");
  const { session } = useSession();

  // «Мои блюда» — только у семьи: своё блюдо принадлежит ребёнку, у врача и
  // диетолога такого списка нет вовсе.
  const familyView = session?.role === "parent";
  const [tab, setTab] = useSectionTab<Tab>("tab", TABS, "recipes");
  const { patientId } = useSelectedPatient();

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
    <PageLayout
      title={t("title")}
      intro={t("intro")}
      actions={
        canEdit && (
          <Button
            type="button"
            className="min-h-touch"
            onClick={() => setView({ kind: "form", recipeId: null })}
          >
            <Plus aria-hidden="true" />
            {t("actions.create")}
          </Button>
        )
      }
    >
      {familyView ? (
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          {/* Вкладка, а не отдельный раздел меню: «Мои блюда» — это тот же
              вопрос «что приготовить», только из своей кухни, а не из общей
              базы (правило П29 канона). */}
          <TabsBar
            label={t("tabsLabel")}
            items={TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
          />

          <TabsContent value="recipes" className="pt-screen">
            <div className="flex flex-col gap-block">
              <RecipeFiltersPanel
                filters={filters}
                rangeInvalid={rangeInvalid}
                onChange={patchFilters}
                onReset={() => setFilters(EMPTY_RECIPE_FILTERS)}
              />

              {/* Правило четырёх состояний — в AsyncSection: там же записано, почему
          ошибка не должна прятать уже показанную выдачу. */}
              <AsyncSection
                loading={recipes.isLoading}
                skeleton={<RecipeListSkeleton />}
                error={
                  recipes.isError
                    ? {
                        title: t("list.errorTitle"),
                        description:
                          errorMessageOf(recipes.error) ??
                          t("common:errors.unexpected"),
                      }
                    : null
                }
                retryLabel={t("common:actions.retry")}
                onRetry={() => void recipes.refetch()}
                isEmpty={items.length === 0}
                empty={
                  <RecipeListEmpty
                    filtersActive={hasActiveFilters(filters)}
                    onResetFilters={() => setFilters(EMPTY_RECIPE_FILTERS)}
                    onCreate={
                      canEdit
                        ? () => setView({ kind: "form", recipeId: null })
                        : undefined
                    }
                  />
                }
              >
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
              </AsyncSection>
            </div>
          </TabsContent>

          <TabsContent value="dishes" className="pt-screen">
            <MyDishesPanel patientId={patientId} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-col gap-block">
          <RecipeFiltersPanel
            filters={filters}
            rangeInvalid={rangeInvalid}
            onChange={patchFilters}
            onReset={() => setFilters(EMPTY_RECIPE_FILTERS)}
          />

          {/* Правило четырёх состояний — в AsyncSection: там же записано, почему
          ошибка не должна прятать уже показанную выдачу. */}
          <AsyncSection
            loading={recipes.isLoading}
            skeleton={<RecipeListSkeleton />}
            error={
              recipes.isError
                ? {
                    title: t("list.errorTitle"),
                    description:
                      errorMessageOf(recipes.error) ??
                      t("common:errors.unexpected"),
                  }
                : null
            }
            retryLabel={t("common:actions.retry")}
            onRetry={() => void recipes.refetch()}
            isEmpty={items.length === 0}
            empty={
              <RecipeListEmpty
                filtersActive={hasActiveFilters(filters)}
                onResetFilters={() => setFilters(EMPTY_RECIPE_FILTERS)}
                onCreate={
                  canEdit
                    ? () => setView({ kind: "form", recipeId: null })
                    : undefined
                }
              />
            }
          >
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
          </AsyncSection>
        </div>
      )}
    </PageLayout>
  );
}
