import {
  Button,
  Checkbox,
  EmptyState,
  formatKcal,
  formatMass,
  formatRatio,
  FormFooter,
  FormSheet,
  RatioBadge,
  toast,
} from "@ketocare/ui";
import { BookOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { SectionLink } from "../../components/SectionLink";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useRecipeSearch } from "../recipes/useRecipes";
import {
  useFitRecipes,
  useSaveFits,
  type RecipeFit,
  type RecipeFitsResponse,
} from "./useRecipeFits";

const SEARCH_LIMIT = 50;
const MAX_SELECTED = 20;

/**
 * Блюда из библиотеки: выбрать рецепты, посмотреть подгонку под приём этого
 * ребёнка и сохранить выбранное в его блюда. Рецепт в библиотеке не меняется.
 */
export function RecipeFitSheet({ patientId }: { patientId: string }) {
  const { t } = useTranslation("recipes");
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <BookOpen aria-hidden="true" />
        {t("fromLibrary.open")}
      </Button>
      <FormSheet
        closeLabel={t("common:actions.close")}
        open={open}
        onOpenChange={setOpen}
        title={t("fromLibrary.title")}
        description={t("fromLibrary.description")}
      >
        {open && (
          <FitFlow patientId={patientId} onClose={() => setOpen(false)} />
        )}
      </FormSheet>
    </div>
  );
}

function FitFlow({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("recipes");
  const fit = useFitRecipes(patientId);
  const [fits, setFits] = useState<RecipeFitsResponse | null>(null);

  if (fits !== null) {
    return (
      <FitReview
        patientId={patientId}
        fits={fits}
        onBack={() => setFits(null)}
        onDone={onClose}
      />
    );
  }

  return (
    <RecipeChoice
      pending={fit.isPending}
      error={
        fit.isError
          ? (errorMessageOf(fit.error) ?? t("common:errors.unexpected"))
          : null
      }
      onCancel={onClose}
      onSubmit={(ids) => fit.mutate(ids, { onSuccess: setFits })}
    />
  );
}

function RecipeChoice({
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (ids: string[]) => void;
}) {
  const { t } = useTranslation("recipes");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const search = useRecipeSearch(
    { q, category: "", ratioMin: "", ratioMax: "", limit: SEARCH_LIMIT },
    true,
  );
  // Черновик кормить нельзя: сервер его и не подгонит.
  const recipes = (search.data?.items ?? []).filter(
    (recipe) => recipe.status === "published",
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id) && next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected.size > 0) onSubmit([...selected]);
      }}
    >
      <Field
        id="recipe-fit-search"
        type="search"
        label={t("fromLibrary.search")}
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />

      {!search.isPending && recipes.length === 0 ? (
        <EmptyState
          size="inline"
          title={t("fromLibrary.empty")}
          description={t("fromLibrary.emptyDescription")}
          // Совет опубликовать рецепт был текстом без ссылки: куда идти,
          // человек искал сам.
          action={
            <Button asChild variant="outline" className="min-h-touch">
              <SectionLink section="recipes">
                {t("fromLibrary.toRecipes")}
              </SectionLink>
            </Button>
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <label className="flex min-h-touch items-center gap-field">
                <Checkbox
                  checked={selected.has(recipe.id)}
                  onChange={() => toggle(recipe.id)}
                />
                <span className="flex-1">{recipe.title}</span>
                {recipe.computed && (
                  <RatioBadge ratio={recipe.computed.ratio} />
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      {error !== null && <FormError>{error}</FormError>}

      <FormFooter
        submitLabel={t("fromLibrary.fit", { count: selected.size })}
        pendingLabel={t("fromLibrary.fitPending")}
        pending={pending}
        disabled={selected.size === 0}
        reason={t("fromLibrary.pickRecipes")}
        onCancel={onCancel}
        cancelLabel={t("common:actions.cancel")}
      />
    </form>
  );
}

function FitReview({
  patientId,
  fits,
  onBack,
  onDone,
}: {
  patientId: string;
  fits: RecipeFitsResponse;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("recipes");
  const save = useSaveFits(patientId);
  const fitted = fits.items.filter((item) => item.status === "fitted");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(fitted.map((item) => item.recipe_id)),
  );
  // Один ключ на рецепт на всё время экрана: повтор не создаст дублей.
  const [keys] = useState(
    () => new Map(fitted.map((item) => [item.recipe_id, crypto.randomUUID()])),
  );

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={(event) => {
        event.preventDefault();
        const picked = fitted.filter((item) => chosen.has(item.recipe_id));
        if (picked.length === 0) return;
        save.mutate(
          picked.map((item) => ({
            idempotencyKey: keys.get(item.recipe_id) as string,
            title: item.title,
            ingredients: (item.ingredients ?? []).map((row) => ({
              product_id: row.product_id,
              grams: row.grams,
            })),
          })),
          {
            onSuccess: () => {
              toast.success(t("fromLibrary.saved", { count: picked.length }));
              onDone();
            },
          },
        );
      }}
    >
      <p className="m-0 text-muted-foreground">
        {t("fromLibrary.target", {
          ratio: formatRatio(fits.target_ratio),
          kcal: formatKcal(fits.target_kcal),
        })}
      </p>

      <ul className="m-0 flex list-none flex-col gap-section p-0">
        {fits.items.map((item) => (
          <FitCard
            key={item.recipe_id}
            item={item}
            targetRatio={fits.target_ratio}
            checked={chosen.has(item.recipe_id)}
            onToggle={() => toggle(item.recipe_id)}
          />
        ))}
      </ul>

      {save.isError && (
        <FormError>
          {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormFooter
        submitLabel={t("fromLibrary.save", { count: chosen.size })}
        pendingLabel={t("fromLibrary.savePending")}
        pending={save.isPending}
        disabled={chosen.size === 0}
        reason={t("fromLibrary.pickDishes")}
        onCancel={onBack}
        cancelLabel={t("fromLibrary.back")}
      />
    </form>
  );
}

function FitCard({
  item,
  targetRatio,
  checked,
  onToggle,
}: {
  item: RecipeFit;
  targetRatio: number;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("recipes");
  const isFitted = item.status === "fitted" && item.dish != null;

  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
      <label className="flex min-h-touch flex-wrap items-center gap-field">
        {isFitted && <Checkbox checked={checked} onChange={onToggle} />}
        <span className="min-w-0 flex-1 font-semibold break-words">
          {item.title}
        </span>
        {item.dish != null && (
          <>
            <RatioBadge
              ratio={item.dish.ratio}
              withinTolerance={item.ratio_within_tolerance ?? undefined}
              targetRatio={targetRatio}
            />
            <span className="text-muted-foreground tabular-nums">
              {t("myDishes.kcal", { value: formatKcal(item.dish.kcal) })}
            </span>
            <span className="w-full text-sm text-muted-foreground tabular-nums">
              {t("fromLibrary.macros", {
                protein: formatMass(item.dish.protein_g),
                carbs: formatMass(item.dish.carbs_g),
              })}
            </span>
          </>
        )}
      </label>

      {item.reason != null && (
        <p className="m-0 text-sm text-warning-strong">{item.reason}</p>
      )}
      {item.reshaped === true && (
        <p className="m-0 text-sm text-warning-strong">
          {t("fromLibrary.reshaped")}
        </p>
      )}
      {(item.withdrawn ?? []).length > 0 && (
        <p className="m-0 text-sm text-warning-strong">
          {t("fromLibrary.withdrawn", {
            names: (item.withdrawn ?? []).join(", "),
          })}
        </p>
      )}

      {(item.ingredients ?? []).length > 0 && (
        <ul className="m-0 list-none p-0 text-sm">
          {(item.ingredients ?? []).map((row) => (
            <li
              key={row.product_id}
              className="flex justify-between gap-field tabular-nums"
            >
              <span className="min-w-0 break-words">{row.name_ru}</span>
              <span className="shrink-0">
                {t("fromLibrary.grams", { value: formatMass(row.grams) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
