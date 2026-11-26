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
  useDebouncedValue,
} from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { AddToPlan } from "../menu/AddToPlan";
import { type CustomDish, useCustomDishes } from "../menu/useDishOptions";
import { useTelegramBack } from "../../lib/useTelegram";
import { ProductComposition } from "./ProductComposition";
import {
  RECIPE_CATEGORIES,
  type Recipe,
  type RecipeCategory,
  useRecipe,
  useRecipePhoto,
  useRecipeSearch,
} from "./useRecipes";

/**
 * Рецепты — только чтение (раздел 9 ТЗ); раздел вкладки «Блюда» (ADR-0075).
 *
 * Правка рецепта — работа диетолога в кабинете: по опубликованному рецепту
 * кормят не одного ребёнка, и менять его с телефона между делом нельзя. А
 * поставить рецепт в меню отсюда можно — «В меню» в карточке.
 *
 * `onOpenChildDish` — перейти к блюду ребёнка, собранному из открытого
 * рецепта: `null` — к их списку, когда таких блюд несколько.
 */
export function RecipesScreen({
  patientId,
  onOpenChildDish,
}: {
  patientId: string;
  onOpenChildDish?: (dishId: string | null) => void;
}) {
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
          onOpenChildDish={onOpenChildDish}
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
  const ownDishes = useCustomDishes(patientId);
  const recipesWithOwnDish = new Set(
    (ownDishes.data ?? []).map((dish) => dish.source_recipe_id),
  );
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
                  {/* Рецепт и блюдо ребёнка из него называются одинаково, а
                      граммы у них разные: строка говорит, что открывается
                      шаблон, ещё до нажатия. */}
                  {recipesWithOwnDish.has(recipe.id) && (
                    <span className="text-sm text-warning-strong">
                      {t("recipes.ownDish.row")}
                    </span>
                  )}
                  {recipe.ratio_fits_prescription === false && (
                    <span className="text-sm text-warning-strong">
                      {t("recipes.ratioDiffers")}
                    </span>
                  )}
                </span>
                {/* Значок нейтральный, как у блюда ребёнка: красный у рецепта
                    рядом с серым у блюда с тем же расхождением читался как
                    «рецепт хуже» (М4). О расхождении говорит строка сервера. */}
                <RatioBadge ratio={recipe.per_portion?.ratio ?? null} />
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
  backLabel,
  embedded = false,
  onOpenChildDish,
}: {
  recipeId: string;
  patientId: string;
  onBack: () => void;
  /** Перейти к блюду ребёнка из этого рецепта. Нет — кнопки перехода нет. */
  onOpenChildDish?: (dishId: string | null) => void;
  /** Куда ведёт «Назад» — словами того места, откуда открыли. */
  backLabel?: string;
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
        {backLabel ?? t("recipes.back")}
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
            onOpenChildDish={onOpenChildDish}
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
  onOpenChildDish,
}: {
  recipe: Recipe;
  patientId: string;
  level: 1 | 2;
  onOpenChildDish?: (dishId: string | null) => void;
}) {
  const { t } = useTranslation();
  const portion = recipe.per_portion;
  const Title = level === 1 ? "h1" : "h2";
  const dishes = useCustomDishes(patientId);
  const ownDishes = (dishes.data ?? []).filter(
    (dish) => dish.source_recipe_id === recipe.id,
  );

  // Порядок — как готовят (М5 аудита Mini App): что это за блюдо, из чего и
  // как его делать, и только потом — куда поставить. «Добавить в меню» над
  // составом заслоняло то, ради чего карточку открывают у плиты.
  return (
    <div className="flex flex-col gap-section">
      {/* Название рецепта из базы бывает длинным словом без пробелов. */}
      <Title className="m-0 break-words text-page-title">{recipe.title}</Title>

      {ownDishes.length > 0 && (
        <OwnDishNote dishes={ownDishes} onOpen={onOpenChildDish} />
      )}

      <RecipePhoto recipeId={recipe.id} photoPath={recipe.photo_path} />

      {/* Показатели ПОРЦИИ, а не всего выхода: у плиты считают порцию, и
          подменить одно другим — это ошибка в разы, а не в процентах. */}
      <Section title={t("recipes.perPortion")} density="compact">
        {portion == null ? (
          <p className="text-muted-foreground">{t("recipes.notComputed")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-field">
            {/* Нейтральный значок, как у блюда ребёнка (М4); расхождение с
                назначением — строкой сервера ниже. */}
            <RatioBadge ratio={portion.ratio} />
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
        {/* Полосой, а не бледной строкой: по граммам рецепта не под
            назначение семья готовила, не заметив пометки (26.11.2026). */}
        {recipe.ratio_fits_prescription === false && (
          <WarningBanner level="warning" title={t("recipes.ratioDiffers")}>
            {t("recipes.ratioDiffersBody")}
          </WarningBanner>
        )}
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

      {/* Рецепт ↔ меню в обе стороны (ADR-0075): из карточки — сразу в
          приём дня, одна порция. Последним: сначала читают, потом ставят. */}
      <Section title={t("recipes.toMenu")} density="compact">
        <AddToPlan
          patientId={patientId}
          dish={{ kind: "recipe", id: recipe.id }}
        />
      </Section>
    </div>
  );
}

/**
 * «У ребёнка своя граммовка этого блюда» — над карточкой общего рецепта.
 *
 * Блюдо ребёнка, собранное из рецепта, называется так же, как рецепт, а граммы
 * у него другие: диетолог пересчитывает их под назначение. Семья открывала
 * рецепт из базы, видела другие граммы и калории, чем на выданной карточке, и
 * решала, что расчёт неверен (сообщение клиники 26.11.2026), — или готовила бы
 * по шаблону. Какое из блюд стоит в сегодняшнем приёме, знает только меню дня:
 * поэтому текст называет и его.
 */
function OwnDishNote({
  dishes,
  onOpen,
}: {
  dishes: readonly CustomDish[];
  onOpen?: (dishId: string | null) => void;
}) {
  const { t } = useTranslation();
  const single = dishes.length === 1 ? dishes[0] : undefined;
  return (
    <WarningBanner level="warning" title={t("recipes.ownDish.title")}>
      <span className="flex flex-col gap-field">
        <span>{t("recipes.ownDish.body")}</span>
        {onOpen !== undefined && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch self-start"
            onClick={() => {
              onOpen(single?.id ?? null);
            }}
          >
            {single !== undefined
              ? t("recipes.ownDish.open")
              : t("recipes.ownDish.openList")}
          </Button>
        )}
      </span>
    </WarningBanner>
  );
}

/**
 * Фото рецепта (Б2): есть — картинка, нет или не загрузилось — ничего.
 *
 * Пустой рамки «фото нет» здесь нет намеренно: в кабинете она держит сетку
 * карточек, а на телефоне это пол-экрана пустоты над составом. Картинка
 * декоративная (`alt` пустой): название стоит над ней.
 */
function RecipePhoto({
  recipeId,
  photoPath,
}: {
  recipeId: string;
  photoPath: string | null;
}) {
  const photo = useRecipePhoto(recipeId, photoPath);
  const blob = photo.data ?? null;
  const [src, setSrc] = useState<string | null>(null);

  // Адрес объекта держит картинку в памяти, пока его не отзовут: отзывается
  // при смене фото и при закрытии карточки.
  useEffect(() => {
    if (blob === null) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  if (src === null) return null;
  return (
    <img
      src={src}
      alt=""
      className="aspect-[4/3] w-full rounded-xl object-cover"
    />
  );
}

function Ingredients({ recipe }: { recipe: Recipe }) {
  return (
    <ProductComposition
      ingredients={recipe.ingredients}
      uncountedIds={recipe.computed?.uncounted_product_ids ?? []}
    />
  );
}
