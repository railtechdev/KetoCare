import {
  AsyncSection,
  Button,
  Input,
  NativeSelect,
  RatioBadge,
  SEARCH_DELAY_MS,
  Section,
  StatusNote,
  WarningBanner,
  cn,
  formatGrams,
  formatKcal,
  formatMass,
  type ProductName,
  useDebouncedValue,
} from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { AddToPlan } from "../menu/AddToPlan";
import { useTelegramBack } from "../../lib/useTelegram";
import {
  RECIPE_CATEGORIES,
  type Recipe,
  type RecipeCategory,
  useProductNames,
  useRecipe,
  useRecipeSearch,
} from "./useRecipes";

/**
 * Рецепты — только чтение (раздел 9 ТЗ); раздел вкладки «Блюда» (ADR-0075).
 *
 * Правка рецепта — работа диетолога в кабинете: по опубликованному рецепту
 * кормят не одного ребёнка, и менять его с телефона между делом нельзя. А
 * поставить рецепт в меню отсюда можно — «В меню» в карточке.
 */
export function RecipesScreen({ patientId }: { patientId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Список остаётся смонтированным под открытой карточкой: поиск, раздел и
  // «Показать ещё» не теряются, когда человек возвращается из карточки.
  return (
    <>
      <div hidden={openId !== null}>
        <RecipeList patientId={patientId} onOpen={setOpenId} />
      </div>
      {openId !== null && (
        <RecipeCard
          recipeId={openId}
          patientId={patientId}
          embedded
          onBack={() => {
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function RecipeList({
  patientId,
  onOpen,
}: {
  patientId: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<RecipeCategory | "">("");
  const categoryId = useId();
  const debounced = useDebouncedValue(query, SEARCH_DELAY_MS);
  const recipes = useRecipeSearch(debounced, category, patientId);
  // Пока набор не устоялся, выдача относится к прежним буквам: `debounced`
  // отстаёт на задержку. «Ничего не нашлось» в эту паузу — ответ не о том, что
  // человек набрал.
  const settling = query.trim() !== debounced.trim();

  return (
    <section
      aria-label={t("recipes.title")}
      className="flex flex-col gap-section"
    >
      <Input
        type="search"
        placeholder={t("recipes.search")}
        aria-label={t("recipes.search")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />

      {/* Разделы — по ответу клиники на вопрос 28: семья выбирает перекус или
          выпечку, а не листает всё подряд. Список, а не полоса кнопок: восемь
          разделов на 360 px в одну строку не встают. */}
      <div className="flex items-center gap-field">
        <label
          className="shrink-0 text-sm text-muted-foreground"
          htmlFor={categoryId}
        >
          {t("recipes.category")}
        </label>
        <NativeSelect
          id={categoryId}
          value={category}
          onChange={(event) => {
            const value = event.target.value;
            setCategory(
              (RECIPE_CATEGORIES as readonly string[]).includes(value)
                ? (value as RecipeCategory)
                : "",
            );
          }}
          className="flex-1"
        >
          <option value="">{t("recipes.allCategories")}</option>
          {RECIPE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`recipes.categories.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* НАД списком, а не под ним: под длинным списком строка о связи
          оказывалась ниже первого экрана (ADR-0036). */}
      {recipes.fetchStatus === "paused" && !recipes.isPending && (
        <StatusNote>{t("errors.waitingForNetwork")}</StatusNote>
      )}

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
        waiting={
          recipes.fetchStatus === "paused"
            ? t("errors.waitingForNetwork")
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void recipes.refetch()}
        isEmpty={
          !settling &&
          !recipes.isFetching &&
          recipes.fetchStatus !== "paused" &&
          recipes.recipes?.length === 0
        }
        empty={
          <p className="text-muted-foreground">{t("recipes.nothingFound")}</p>
        }
      >
        <ul className="flex flex-col">
          {(recipes.recipes ?? []).map((recipe) => (
            <li key={recipe.id}>
              <button
                type="button"
                className="flex min-h-(--spacing-touch) w-full items-center gap-field py-2 text-left"
                onClick={() => {
                  onOpen(recipe.id);
                }}
              >
                {/* Без `min-w-0` строка списка не уже самого длинного слова
                    названия и выталкивает соотношение за край экрана. */}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">{recipe.title}</span>
                  {recipe.ratio_fits_prescription === false && (
                    <span className="text-sm text-warning-strong">
                      {t("recipes.ratioDiffers")}
                    </span>
                  )}
                </span>
                <RatioBadge
                  ratio={recipe.per_portion?.ratio ?? null}
                  withinTolerance={recipe.ratio_fits_prescription ?? undefined}
                />
              </button>
            </li>
          ))}
        </ul>
        {/* Следующая страница — по просьбе, а не молча обрезанный список. */}
        {recipes.hasNextPage && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch w-full"
            disabled={recipes.isFetchingNextPage}
            aria-busy={recipes.isFetchingNextPage || undefined}
            onClick={() => void recipes.fetchNextPage()}
          >
            {recipes.isFetchingNextPage
              ? t("actions.loading")
              : t("actions.showMore")}
          </Button>
        )}
      </AsyncSection>
    </section>
  );
}

/**
 * Карточка рецепта — во вкладке «Блюда» и из меню дня («Как готовить»).
 *
 * `embedded` — внутри вкладки «Блюда», где заголовок страницы уже есть;
 * иначе карточка — страница сама по себе, со своим заголовком первого уровня.
 */
export function RecipeCard({
  recipeId,
  patientId,
  onBack,
  embedded = false,
}: {
  recipeId: string;
  patientId: string;
  onBack: () => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const recipe = useRecipe(recipeId, patientId);

  // Кнопка «Назад» самого Telegram: без неё аппаратный «Назад» на Android
  // закрывает весь Mini App, и родитель из карточки попадает в чат, а не к
  // списку (находка М8 аудита). Вне Telegram остаётся внутренняя кнопка.
  useTelegramBack(onBack);
  const Root = embedded ? "section" : "main";

  return (
    <Root className={cn("flex flex-col gap-section", !embedded && "p-section")}>
      <Button
        variant="ghost"
        className="min-h-touch self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("recipes.back")}
      </Button>

      {/* Строка о связи стоит НАВЕРХУ, а не под содержимым: у длинного
          рецепта она оказывалась ниже первого экрана. */}
      {recipe.fetchStatus === "paused" && !recipe.isPending && (
        <StatusNote>{t("errors.waitingForNetwork")}</StatusNote>
      )}

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
        waiting={
          recipe.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void recipe.refetch()}
        isEmpty={false}
        empty={null}
      >
        {recipe.data !== undefined && (
          <RecipeBody
            recipe={recipe.data}
            patientId={patientId}
            level={embedded ? 2 : 1}
          />
        )}
      </AsyncSection>
    </Root>
  );
}

function RecipeBody({
  recipe,
  patientId,
  level,
}: {
  recipe: Recipe;
  patientId: string;
  level: 1 | 2;
}) {
  const { t } = useTranslation();
  const portion = recipe.per_portion;
  const Title = level === 1 ? "h1" : "h2";

  return (
    <div className="flex flex-col gap-section">
      {/* Название рецепта из базы бывает длинным словом без пробелов. */}
      <Title className="m-0 break-words text-page-title">{recipe.title}</Title>

      {/* Показатели ПОРЦИИ, а не всего выхода: у плиты считают порцию, и
          подменить одно другим — это ошибка в разы, а не в процентах. */}
      <Section title={t("recipes.perPortion")} density="compact">
        {portion == null ? (
          <p className="text-muted-foreground">{t("recipes.notComputed")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-field">
            <RatioBadge
              ratio={portion.ratio}
              withinTolerance={recipe.ratio_fits_prescription ?? undefined}
            />
            <span className="tabular-nums">
              {t("recipes.kcal", { kcal: formatKcal(portion.kcal) })}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {t("recipes.macros", {
                fat: formatGrams(portion.fat),
                protein: formatGrams(portion.protein),
                carbs: formatGrams(portion.carbs),
              })}
            </span>
          </div>
        )}
        <p className="text-muted-foreground tabular-nums">
          {t("recipes.servings", {
            count: recipe.servings,
            yield: formatMass(recipe.yield_g),
          })}
        </p>
      </Section>

      {recipe.ratio_fits_prescription === false && (
        <p className="m-0 text-sm text-warning-strong">
          {t("recipes.ratioDiffers")}
        </p>
      )}

      {/* Рецепт ↔ меню в обе стороны (ADR-0075): из карточки — сразу в
          приём дня, одна порция. */}
      <Section title={t("recipes.toMenu")} density="compact">
        <AddToPlan
          patientId={patientId}
          dish={{ kind: "recipe", id: recipe.id }}
        />
      </Section>

      {/* По карточке готовят: показатели порции без «из чего и сколько» —
          инструкция без рецепта. Масштаб назван в заголовке: рядом стоят
          показатели ОДНОЙ порции, а граммовка — ВСЕГО выхода, и перепутать
          их значит ошибиться в разы (находка М2 аудита). */}
      <Section
        title={t("recipes.composition", { count: recipe.servings })}
        density="compact"
      >
        <Ingredients recipe={recipe} />
      </Section>

      {/* Текст приготовления у рецепта необязателен: без него блока нет. */}
      {recipe.instructions.trim() !== "" && (
        <Section title={t("recipes.instructions")} density="compact">
          <p className="break-words whitespace-pre-line">
            {recipe.instructions}
          </p>
        </Section>
      )}
    </div>
  );
}

/** Имя продукта словами: известное, удалённое, не дошедшее или ещё в пути. */
function productName(state: ProductName, t: (key: string) => string): string {
  switch (state.kind) {
    case "name":
      return state.name;
    case "missing":
      return t("recipes.unknownProduct");
    case "unavailable":
      return t("recipes.nameUnavailable");
    case "pending":
      return t("recipes.loadingName");
  }
}

function Ingredients({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const names = useProductNames(
    recipe.ingredients.map((ingredient) => ingredient.product_id),
  );

  if (recipe.ingredients.length === 0) {
    return (
      <p className="text-muted-foreground">{t("recipes.noComposition")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-field">
      {/* Показатели рецепта посчитаны в том числе по выведенному продукту —
          знать об этом нужно до того, как по рецепту приготовят. Та же
          оговорка, что в кабинете: по обеим карточкам готовят одинаково. */}
      {Object.keys(names.withdrawn).length > 0 && (
        <WarningBanner level="warning" title={t("recipes.withdrawnTitle")}>
          {t("recipes.withdrawnBody", {
            list: Object.values(names.withdrawn).join(", "),
          })}
        </WarningBanner>
      )}

      <ul className="flex list-none flex-col gap-1 p-0">
        {recipe.ingredients.map((ingredient) => (
          <li
            key={ingredient.product_id}
            className="flex flex-wrap justify-between gap-field"
          >
            {/* Граммовка видна всегда, даже пока имена в пути: состав,
                спрятанный целиком, — это карточка без рецепта, а по ней
                готовят. */}
            <span className="min-w-0 break-words">
              {productName(names.stateOf(ingredient.product_id), t)}
              {names.withdrawn[ingredient.product_id] !== undefined && (
                <span className="ml-2 text-sm text-warning-strong">
                  {t("recipes.withdrawn")}
                </span>
              )}
              {/* По списку из сохранённого расчёта, а не по живой отметке
                  продукта: пометка говорит о показателях рецепта, а они
                  посчитаны так, как там записано (ADR-0054). */}
              {recipe.computed?.uncounted_product_ids?.includes(
                ingredient.product_id,
              ) && (
                <span className="ml-2 text-sm text-muted-foreground">
                  {t("recipes.uncounted")}
                </span>
              )}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {t("recipes.grams", { value: formatMass(ingredient.grams) })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
