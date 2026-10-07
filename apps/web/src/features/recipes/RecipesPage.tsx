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
  useAddressPatch,
  useAddressState,
  useSectionItem,
  useSectionTab,
} from "../../routes/useSectionTab";
import { errorMessageOf } from "../../lib/api";
import { SECTIONS_BY_ROLE } from "../auth/roles";
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
  RECIPE_CATEGORIES,
  RECIPES_PAGE_SIZE,
  type RecipeFilters,
} from "./types";
import { useRecipeSearch } from "./useRecipes";
import { queryState } from "../../lib/queryState";

/**
 * Открытый рецепт и открытая форма живут в адресе (`?item=`, правила П1, П30).
 *
 * До этого карточка открывалась состоянием: адрес оставался `/app/recipes`,
 * «Назад» браузера уводил из раздела, F5 возвращал к списку, а ссылку на рецепт
 * нельзя было переслать — при том что по рецепту готовят и его обсуждают с
 * диетологом. Форма жила состоянием дольше и по той же причине теряла место:
 * F5 посреди правки возвращал к списку, а «Назад» уводил из раздела.
 *
 * Адресуется то, КАКАЯ форма открыта (`item=new`, `item=edit:<id>`), а не её
 * содержимое: незаписанный ввод F5 по-прежнему не переживает, но человек
 * оказывается в той же форме того же рецепта.
 */
const NEW_ITEM = "new";
const EDIT_PREFIX = "edit:";

function formOf(item: string | undefined): { recipeId: string | null } | null {
  if (item === NEW_ITEM) return { recipeId: null };
  if (item?.startsWith(EDIT_PREFIX)) {
    const recipeId = item.slice(EDIT_PREFIX.length);
    return recipeId === "" ? null : { recipeId };
  }
  return null;
}

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
  //
  // Остальные отборы — категория и границы соотношения — тоже в адресе
  // (правило П1): диетолог, открывший рецепт из отобранной выдачи, «Назад»
  // возвращался к полной базе и отбирал заново. Поля держат своё состояние,
  // чтобы ввод не ждал навигации; в адрес уходит то же значение одним
  // переходом.
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  const [filters, setFilters] = useState<RecipeFilters>(() => ({
    ...EMPTY_RECIPE_FILTERS,
    q: address.q ?? "",
    category:
      RECIPE_CATEGORIES.find((value) => value === address.category) ?? "",
    ratioMin: address.ratioMin ?? "",
    ratioMax: address.ratioMax ?? "",
  }));
  const [openId, setOpenId] = useSectionItem();
  const form = formOf(openId);
  const setForm = (next: { recipeId: string | null } | null) =>
    setOpenId(
      next === null
        ? undefined
        : next.recipeId === null
          ? NEW_ITEM
          : `${EDIT_PREFIX}${next.recipeId}`,
    );

  // Поиск уходит с задержкой: иначе полнотекстовый запрос дёргается на каждой букве.
  const debouncedQuery = useDebouncedValue(filters.q, SEARCH_DELAY_MS);
  const rangeInvalid = isRatioRangeInvalid(filters);
  const recipes = useRecipeSearch(
    { ...filters, q: debouncedQuery },
    !rangeInvalid,
  );

  function writeAddress(next: RecipeFilters) {
    patchAddress({
      q: next.q.trim() === "" ? undefined : next.q,
      category: next.category === "" ? undefined : next.category,
      ratioMin: next.ratioMin.trim() === "" ? undefined : next.ratioMin,
      ratioMax: next.ratioMax.trim() === "" ? undefined : next.ratioMax,
    });
  }

  function patchFilters(patch: Partial<RecipeFilters>) {
    // Любая смена фильтра возвращает выдачу к первой странице: иначе после
    // «показать ещё» новый фильтр запросил бы сразу сотню карточек.
    const next = { ...filters, ...patch, limit: RECIPES_PAGE_SIZE };
    setFilters(next);
    writeAddress(next);
  }

  /**
   * Сброс фильтров чистит и адрес.
   *
   * Иначе в поле пусто, а в адресе остаётся `?q=`, и F5 возвращает то, что
   * человек только что убрал: экран и адрес расходятся молча.
   */
  function resetFilters() {
    setFilters(EMPTY_RECIPE_FILTERS);
    writeAddress(EMPTY_RECIPE_FILTERS);
  }

  if (form !== null) {
    return (
      <RecipeFormPanel
        recipeId={form.recipeId}
        // Форма сменяется карточкой одним переходом: открытая форма и есть
        // `?item=`, и два шага подряд оставили бы между ними пустой адрес.
        onSaved={(recipeId) => setOpenId(recipeId)}
        // Отмена возвращает туда, откуда открыли: правку — в карточку рецепта,
        // создание — в список.
        onCancel={() =>
          setOpenId(form.recipeId === null ? undefined : form.recipeId)
        }
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
        canCalculate={
          session !== null &&
          SECTIONS_BY_ROLE[session.role].includes("calculator")
        }
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

          <TabsContent
            value="recipes"
            className="pt-screen rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <div className="flex flex-col gap-section">
              <RecipeFiltersPanel
                filters={filters}
                rangeInvalid={rangeInvalid}
                onChange={patchFilters}
                onReset={resetFilters}
              />

              {/* Правило пяти состояний — в AsyncSection: там же записано, почему
          ошибка не должна прятать уже показанную выдачу. */}
              <AsyncSection
                {...queryState(recipes)}
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

          <TabsContent
            value="dishes"
            className="pt-screen rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <MyDishesPanel patientId={patientId} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-col gap-section">
          <RecipeFiltersPanel
            filters={filters}
            rangeInvalid={rangeInvalid}
            onChange={patchFilters}
            onReset={resetFilters}
          />

          {/* Правило пяти состояний — в AsyncSection: там же записано, почему
          ошибка не должна прятать уже показанную выдачу. */}
          <AsyncSection
            {...queryState(recipes)}
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
