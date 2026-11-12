import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RatioBadge,
  SEARCH_DELAY_MS,
  formatKcal,
  formatMass,
  toast,
  useDebouncedValue,
} from "@ketocare/ui";
import { ArrowLeft, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { PatientViewLink } from "../doctor/PatientViewLink";
import { useCustomDishes } from "../dishes/useCustomDishes";
import {
  useFitRecipes,
  useSaveFits,
  type RecipeFit,
} from "../dishes/useRecipeFits";
import { useRecipeSearch } from "../recipes/useRecipes";
import { useAddToMenuMutation, type DishKind } from "./useMenu";

/** Сколько рецептов показать в ячейке: выбирают по названию, а не листают. */
const RECIPE_LIMIT = 8;

interface Props {
  patientId: string;
  date: string;
  mealIndex: number;
  dayLabel: string;
}

/**
 * «Добавить» в ячейке недели: блюдо ребёнка или рецепт базы ставится в этот
 * день и приём, без сборки дня под сеткой.
 *
 * **Один рецепт не даёт двух результатов молча.** Через «Блюда → Добавить из
 * рецептов» рецепт пересчитывается под приём ребёнка, а в меню он встаёт с
 * граммами базы. Ячейка не выбирает за человека: у рецепта она спрашивает —
 * «Пересчитать под приём» (тот же подбор, что в «Блюдах»: показывает граммы,
 * сохраняет блюдо ребёнку и ставит его в ячейку) или «Как в рецепте» — с
 * граммами базы, о чём сказано прямо.
 *
 * День пишется целиком, как и в сборке дня: сервер читает день перед записью,
 * прежние позиции уходят без изменений и сохраняют отметки «съедено»
 * (`useAddToMenuMutation`).
 */
export function WeekCellAdd({ patientId, date, mealIndex, dayLabel }: Props) {
  const { t } = useTranslation("menu");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start px-1 text-muted-foreground"
          aria-label={t("week.addTo", { day: dayLabel, number: mealIndex })}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("week.add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(32rem,80vh)] w-80 flex-col gap-field overflow-y-auto"
        aria-label={t("week.addTo", { day: dayLabel, number: mealIndex })}
      >
        {open && (
          <CellPicker
            patientId={patientId}
            date={date}
            mealIndex={mealIndex}
            dayLabel={dayLabel}
            onDone={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

interface RecipeChoice {
  id: string;
  title: string;
}

function CellPicker({
  patientId,
  date,
  mealIndex,
  dayLabel,
  onDone,
}: Props & { onDone: () => void }) {
  const { t } = useTranslation("menu");
  const [query, setQuery] = useState("");
  const [recipe, setRecipe] = useState<RecipeChoice | null>(null);
  const searchId = useId();
  const debounced = useDebouncedValue(query, SEARCH_DELAY_MS);
  const needle = query.trim().toLocaleLowerCase("ru-RU");

  const dishes = useCustomDishes(patientId);
  const recipes = useRecipeSearch(
    {
      q: debounced.trim(),
      category: "",
      ratioMin: "",
      ratioMax: "",
      limit: RECIPE_LIMIT,
    },
    true,
  );
  const add = useAddToMenuMutation(patientId);
  // Двойное нажатие не ставит блюдо дважды: экран между нажатиями в одном
  // такте не перерисован, и `isPending` его не остановил бы.
  const busy = useRef(false);

  function addDish(kind: DishKind, id: string, title: string) {
    if (busy.current) return;
    busy.current = true;
    add.mutate(
      { date, mealIndex, kind, id, portionFactor: 1 },
      {
        onSuccess: () => {
          toast.success(t("week.added", { title, day: dayLabel }));
          onDone();
        },
        onSettled: () => {
          busy.current = false;
        },
      },
    );
  }

  if (recipe !== null) {
    return (
      <RecipeStep
        patientId={patientId}
        recipe={recipe}
        pending={add.isPending}
        error={add.error}
        onBack={() => {
          setRecipe(null);
          add.reset();
        }}
        onAdd={addDish}
      />
    );
  }

  const ownDishes = (dishes.data ?? []).filter(
    (dish) =>
      needle === "" || dish.title.toLocaleLowerCase("ru-RU").includes(needle),
  );
  // Черновик рецепта ребёнку не ставят: сервер и не подгонит его.
  const published = (recipes.data?.items ?? []).filter(
    (item) => item.status === "published",
  );

  return (
    <>
      <label htmlFor={searchId} className="text-sm font-medium">
        {t("week.search")}
      </label>
      <Input
        id={searchId}
        type="search"
        className="min-h-touch"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-sm font-semibold text-muted-foreground">
          {t("week.ownDishes")}
        </h4>
        {dishes.isPending ? (
          <p className="m-0 text-sm text-muted-foreground" role="status">
            {t("week.dishesLoading")}
          </p>
        ) : dishes.isError ? (
          <p className="m-0 text-sm">{t("week.dishesError")}</p>
        ) : (dishes.data ?? []).length === 0 ? (
          // Пустой список — не тупик: блюдо собирают в разделе «Блюда» карты.
          <p className="m-0 text-sm">
            {t("week.noDishes")}{" "}
            <PatientViewLink
              patientId={patientId}
              view="dishes"
              className="font-medium underline"
            >
              {t("week.toDishes")}
            </PatientViewLink>
          </p>
        ) : ownDishes.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {t("week.nothingFound")}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {ownDishes.map((dish) => (
              <li key={dish.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-touch w-full justify-start text-left whitespace-normal"
                  disabled={add.isPending}
                  onClick={() => addDish("custom", dish.id, dish.title)}
                >
                  {dish.title}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="m-0 text-sm font-semibold text-muted-foreground">
          {t("week.recipes")}
        </h4>
        {recipes.isPending ? (
          <p className="m-0 text-sm text-muted-foreground" role="status">
            {t("week.recipesLoading")}
          </p>
        ) : recipes.isError ? (
          <p className="m-0 text-sm">{t("week.recipesError")}</p>
        ) : published.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {t("week.nothingFound")}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {published.map((item) => (
              <li key={item.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-touch w-full justify-between gap-field text-left whitespace-normal"
                  disabled={add.isPending}
                  onClick={() => {
                    add.reset();
                    setRecipe({ id: item.id, title: item.title });
                  }}
                >
                  <span className="min-w-0 break-words">{item.title}</span>
                  {item.computed && <RatioBadge ratio={item.computed.ratio} />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {add.error !== null && (
        <FormError>{errorMessageOf(add.error) ?? t("errors.save")}</FormError>
      )}
    </>
  );
}

/**
 * Рецепт в ячейку: пересчитать под приём или поставить с граммами базы.
 *
 * Пересчёт — тот же подбор, что «Блюда → Добавить из рецептов» (ADR-0059):
 * граммы показываются до сохранения, а сохраняется блюдо ребёнка обычной
 * ручкой записи — и уже оно встаёт в ячейку. Рецепт базы не меняется.
 */
function RecipeStep({
  patientId,
  recipe,
  pending,
  error,
  onBack,
  onAdd,
}: {
  patientId: string;
  recipe: RecipeChoice;
  pending: boolean;
  error: unknown;
  onBack: () => void;
  onAdd: (kind: DishKind, id: string, title: string) => void;
}) {
  const { t } = useTranslation("menu");
  const fit = useFitRecipes(patientId);
  const save = useSaveFits(patientId);
  // Один ключ на всё время шага: повтор после обрыва не создаст второе блюдо.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const result: RecipeFit | undefined = fit.data?.items[0];
  const fitted = result?.status === "fitted" && result.dish != null;
  // В рецепте продукт, исключённый ребёнку: «как в рецепте» не предлагается —
  // это значило бы поставить исключённое одним нажатием после слова «нельзя».
  const excluded = result?.status === "excluded";
  const busy = pending || fit.isPending || save.isPending;
  const failure = fit.error ?? save.error ?? error;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />
        {t("week.back")}
      </Button>
      <p className="m-0 font-medium break-words">{recipe.title}</p>

      {result === undefined ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t("week.recipeAsIs")}
        </p>
      ) : fitted ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-sm text-muted-foreground">
            {t("week.fitTarget", {
              kcal: formatKcal(fit.data?.target_kcal ?? 0),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-field">
            <RatioBadge
              ratio={result.dish?.ratio ?? null}
              withinTolerance={result.ratio_within_tolerance ?? undefined}
              targetRatio={fit.data?.target_ratio}
            />
            <span className="text-sm tabular-nums">
              {t("week.kcal", { value: formatKcal(result.dish?.kcal ?? 0) })}
            </span>
          </div>
          <ul className="m-0 list-none p-0 text-sm">
            {(result.ingredients ?? []).map((row) => (
              <li
                key={row.product_id}
                className="flex justify-between gap-field tabular-nums"
              >
                <span className="min-w-0 break-words">{row.name_ru}</span>
                <span className="shrink-0">
                  {t("week.grams", { value: formatMass(row.grams) })}
                </span>
              </li>
            ))}
          </ul>
          {(result.withdrawn ?? []).length > 0 && (
            <p className="m-0 text-sm text-warning-strong">
              {t("week.fitWithdrawn", {
                names: (result.withdrawn ?? []).join(", "),
              })}
            </p>
          )}
          {result.reshaped === true && (
            <p className="m-0 text-sm text-warning-strong">
              {t("week.fitReshaped")}
            </p>
          )}
        </div>
      ) : (
        <p className="m-0 text-sm text-warning-strong">
          {result.reason ?? t("week.fitFailed")}
        </p>
      )}

      <div className="flex flex-col items-stretch gap-field">
        {fitted ? (
          <Button
            type="button"
            className="min-h-touch"
            disabled={busy}
            aria-busy={save.isPending || pending || undefined}
            onClick={() => {
              if (busy || result === undefined) return;
              save.mutate(
                [
                  {
                    idempotencyKey: attemptKey,
                    title: result.title,
                    ingredients: (result.ingredients ?? []).map((row) => ({
                      product_id: row.product_id,
                      grams: row.grams,
                    })),
                  },
                ],
                {
                  onSuccess: (created) => {
                    const dish = created[0];
                    if (dish !== undefined) {
                      onAdd("custom", dish.id, dish.title);
                    }
                  },
                },
              );
            }}
          >
            {t("week.saveFitted")}
          </Button>
        ) : (
          result === undefined && (
            <Button
              type="button"
              className="min-h-touch"
              disabled={busy}
              aria-busy={fit.isPending || undefined}
              onClick={() => fit.mutate([recipe.id])}
            >
              {fit.isPending ? t("week.fitting") : t("week.fit")}
            </Button>
          )
        )}
        {!excluded && (
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-touch whitespace-normal"
            disabled={busy}
            onClick={() => onAdd("recipe", recipe.id, recipe.title)}
          >
            {t("week.addAsIs")}
          </Button>
        )}
      </div>

      {failure != null && (
        <FormError>
          {errorMessageOf(failure) ?? t("common:errors.unexpected")}
        </FormError>
      )}
    </>
  );
}
