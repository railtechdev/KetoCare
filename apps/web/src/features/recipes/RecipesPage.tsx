import {
  AsyncSection,
  Button,
  Tabs,
  TabsBar,
  TabsContent,
  useDebouncedValue,
  SEARCH_DELAY_MS,
} from "@ketocare/ui";
import { Plus, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import {
  useSectionItem,
  useSectionQuery,
  useSectionTab,
} from "../../routes/useSectionTab";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { MyDishesPanel } from "../dishes/MyDishesPanel";
import { useSelectedPatient } from "../patients/useSelectedPatient";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeFiltersPanel } from "./RecipeFiltersPanel";
import { RecipeFormPanel } from "./RecipeFormPanel";
import { RecipeImportPanel } from "./RecipeImportPanel";
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

/**
 * Открытый рецепт живёт в адресе (`?item=`, правило П30 канона).
 *
 * До этого карточка открывалась состоянием: адрес оставался `/app/recipes`,
 * «Назад» браузера уводил из раздела, F5 возвращал к списку, а ссылку на рецепт
 * нельзя было переслать — при том что по рецепту готовят и его обсуждают с
 * диетологом.
 *
 * Форма правки остаётся состоянием: это шаг внутри карточки, а не отдельный
 * предмет, и адресовать «наполовину заполненную форму» нечем.
 */
type FormView = { recipeId: string | null };

/**
 * Раздел «Рецепты» (раздел 8.1 ТЗ).
 *
 * Список, карточка и форма живут в одном разделе маршрута: `/app/$section` не
 * знает о вложенных путях, поэтому что показывать, решает состояние экрана.
 */
const TABS = ["recipes", "dishes"] as const;

type Tab = (typeof TABS)[number];

//: Псевдо-идентификатор открытого экрана импорта. Тот же приём, что у
//: справочника продуктов: `/app/$section` не знает о вложенных путях, но что
//: именно открыто, живёт в адресе (`?item=`), а не в состоянии экрана.
const IMPORT_ITEM = "import";

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

  // Запрос — в адресе, как в справочнике продуктов: калькулятор, не нашедший
  // продукт, ведёт сюда с уже введённым словом («суп из говядины» — это блюдо,
  // и искать его надо здесь). Заодно поиск переживает F5 и пересылается
  // ссылкой: до этого он жил только в памяти вкладки.
  const [urlQuery, setUrlQuery] = useSectionQuery();
  const [filters, setFilters] = useState<RecipeFilters>({
    ...EMPTY_RECIPE_FILTERS,
    q: urlQuery,
  });
  const [openId, setOpenId] = useSectionItem();
  const [form, setForm] = useState<FormView | null>(null);

  // Поиск уходит с задержкой: иначе полнотекстовый запрос дёргается на каждой букве.
  const debouncedQuery = useDebouncedValue(filters.q, SEARCH_DELAY_MS);
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
    // В адрес уходит только строка поиска: остальные фильтры принадлежат
    // экрану, а по слову сюда приходят извне.
    if (patch.q !== undefined) setUrlQuery(patch.q);
  }

  /**
   * Сброс фильтров чистит и адрес.
   *
   * Иначе в поле пусто, а в адресе остаётся `?q=`, и F5 возвращает то, что
   * человек только что убрал: экран и адрес расходятся молча.
   */
  function resetFilters() {
    setFilters(EMPTY_RECIPE_FILTERS);
    setUrlQuery("");
  }

  if (form !== null) {
    return (
      <RecipeFormPanel
        recipeId={form.recipeId}
        onSaved={(recipeId) => {
          setForm(null);
          setOpenId(recipeId);
        }}
        onCancel={() => {
          setForm(null);
          if (form.recipeId === null) setOpenId(undefined);
        }}
      />
    );
  }

  if (openId === IMPORT_ITEM && canEdit) {
    return <RecipeImportPanel onDone={() => setOpenId(undefined)} />;
  }

  if (openId !== undefined) {
    return (
      <RecipeDetail
        recipeId={openId}
        canEdit={canEdit}
        onBack={() => setOpenId(undefined)}
        onEdit={(recipeId) => setForm({ recipeId })}
      />
    );
  }

  const items = recipes.data?.items ?? [];

  return (
    // Выдача — плитки с фотографиями: страница, на которой ищут, а не читают.
    <PageLayout
      title={t("title")}
      intro={t("intro")}
      width="wide"
      actions={
        canEdit && (
          <>
            <Button
              type="button"
              className="min-h-touch"
              onClick={() => setForm({ recipeId: null })}
            >
              <Plus aria-hidden="true" />
              {t("actions.create")}
            </Button>
            {/* Вторичное действие рядом с первичным — как у справочника
                продуктов. Импорт заводит сборник разом, при заведении клиники;
                создание рецепта — ежедневная работа, и первичное действие
                остаётся за ней (правило П14 канона). */}
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              onClick={() => setOpenId(IMPORT_ITEM)}
            >
              <Upload aria-hidden="true" />
              {t("actions.import")}
            </Button>
          </>
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
                onReset={resetFilters}
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
                    onResetFilters={resetFilters}
                    onCreate={
                      canEdit ? () => setForm({ recipeId: null }) : undefined
                    }
                  />
                }
              >
                <RecipeList
                  recipes={items}
                  total={recipes.data?.total ?? items.length}
                  showStatus={canEdit}
                  onOpen={(recipeId) => setOpenId(recipeId)}
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
            onReset={resetFilters}
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
                onResetFilters={resetFilters}
                onCreate={
                  canEdit ? () => setForm({ recipeId: null }) : undefined
                }
              />
            }
          >
            <RecipeList
              recipes={items}
              total={recipes.data?.total ?? items.length}
              showStatus={canEdit}
              onOpen={(recipeId) => setOpenId(recipeId)}
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
