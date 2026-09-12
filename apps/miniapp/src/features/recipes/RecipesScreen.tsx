import {
  AsyncSection,
  StatusNote,
  Button,
  Input,
  RatioBadge,
  Section,
  useDebouncedValue,
  WarningBanner,
  SEARCH_DELAY_MS,
  type ProductName,
} from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { showBackButton } from "../../lib/telegram";
import {
  type Recipe,
  useProductNames,
  useRecipe,
  useRecipeSearch,
} from "./useRecipes";

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
  const debounced = useDebouncedValue(query, SEARCH_DELAY_MS);
  const recipes = useRecipeSearch(debounced);
  // Пока набор не устоялся, выдача относится к прежним буквам: `debounced`
  // отстаёт на задержку. «Ничего не нашлось» в эту паузу — ответ не о том, что
  // человек набрал (та же правка, что в поиске продукта).
  const settling = query.trim() !== debounced.trim();

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
          recipes.data?.length === 0
        }
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
                {/* Без `min-w-0` строка списка не уже самого длинного слова
                    названия и выталкивает соотношение за край экрана. */}
                <span className="min-w-0 flex-1 break-words">
                  {recipe.title}
                </span>
                <RatioBadge ratio={recipe.per_portion?.ratio ?? null} />
              </button>
            </li>
          ))}
        </ul>
      </AsyncSection>

      {/* Рядом со списком, а не внутри пустого состояния: при непустой прошлой
          выдаче пустоты нет, и о паузе не сказал бы никто. Ветка ожидания кита
          закрывает только первый поиск — дальше `loading` ложен, потому что
          прошлая выдача держится намеренно (`useRecipes.ts`). Что значит сама
          пауза — в ADR-0036. */}
      {recipes.fetchStatus === "paused" && !recipes.isPending && (
        <StatusNote>{t("errors.waitingForNetwork")}</StatusNote>
      )}
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

  // Кнопка «Назад» самого Telegram: без неё аппаратный «Назад» на Android
  // закрывает весь Mini App, и родитель из карточки попадает в чат, а не к
  // списку (находка М8 аудита). Вне Telegram остаётся внутренняя кнопка.
  useEffect(() => showBackButton(onBack), [onBack]);

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
        waiting={
          recipe.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void recipe.refetch()}
        isEmpty={false}
        empty={null}
      >
        {recipe.data !== undefined && <RecipeBody recipe={recipe.data} />}
      </AsyncSection>

      {/* Та же немота, что была у списка: со второго открытия рецепт уже в
          кэше, `isPending` ложен, и ветка ожидания кита не срабатывает. А
          рецепт могли поправить с тех пор, как список загрузился, и по нему
          готовят (`useRecipes.ts`). */}
      {recipe.fetchStatus === "paused" && !recipe.isPending && (
        <StatusNote>{t("errors.waitingForNetwork")}</StatusNote>
      )}
    </main>
  );
}

function RecipeBody({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const portion = recipe.per_portion;

  return (
    <div className="flex flex-col gap-block">
      {/* Название рецепта из базы бывает длинным словом без пробелов. */}
      <h1 className="break-words text-page-title">{recipe.title}</h1>

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

      <Section title={t("recipes.instructions")} density="compact">
        <p className="break-words whitespace-pre-line">{recipe.instructions}</p>
      </Section>
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
                <span className="ml-2 text-sm text-warning">
                  {t("recipes.withdrawn")}
                </span>
              )}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {t("recipes.grams", { value: ingredient.grams })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
