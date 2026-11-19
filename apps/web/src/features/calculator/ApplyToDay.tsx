import { Button, Section, toast } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { formatDayLabel } from "../menu/dates";
import { useMenuQuery, useRefreshMenuItemMutation } from "../menu/useMenu";

/** The child's dish the calculator has just written. */
export interface SavedDish {
  id: string;
  /** The library recipe it was fitted from, if any. */
  sourceRecipeId: string | null;
}

/**
 * «Применить в меню на этот день» — for a dish opened from a week cell.
 *
 * The day keeps the composition it was planned with (ADR-0016), so a saved
 * correction used to stop at the child's dishes: the dietitian had to come
 * back to the cell and press «Взять новый состав», and a day holding a library
 * recipe could not take the corrected copy at all (dietitian, 19.11.2026).
 * Opened from a day, the intent is plain, and the block offers exactly that
 * day (ADR-0091). Other days with this dish stay as they are: they may already
 * be with the family, and each changes only by its own press.
 */
export function ApplyToDay({
  patientId,
  date,
  menuItemId,
  saved,
  onApplied,
}: {
  patientId: string;
  date: string;
  menuItemId: string;
  /** `null` — nothing saved yet on this screen. */
  saved: SavedDish | null;
  onApplied: () => void;
}) {
  const { t } = useTranslation("calculator");
  const menu = useMenuQuery(patientId, date);
  const refresh = useRefreshMenuItemMutation(patientId);
  const item = menu.data?.items.find((entry) => entry.id === menuItemId);

  // The day is gone or the dish was taken out of it: nothing to offer.
  if (item === undefined) return null;

  const where = t("applyToDay.where", {
    day: formatDayLabel(date),
    meal: t("menu:meal.name", { index: item.meal_index }),
  });
  const sameDish = saved !== null && item.custom_dish_id === saved.id;
  const fittedFromRecipe =
    saved !== null &&
    item.recipe_id !== null &&
    saved.sourceRecipeId === item.recipe_id;
  // A recipe standing at another portion: how much food the dish would carry
  // is not plain, and the server refuses it (ADR-0091) — say so up front. A
  // recipe for several servings at ×1 is refused by the server alone: the
  // block does not know the recipe's servings.
  const portionAmbiguous = fittedFromRecipe && item.portion_factor !== 1;
  const applicable = sameDish || (fittedFromRecipe && !portionAmbiguous);

  const description = item.eaten
    ? t("applyToDay.eaten")
    : saved === null
      ? t("applyToDay.beforeSave")
      : applicable
        ? t("applyToDay.ready")
        : portionAmbiguous
          ? t("applyToDay.portionAmbiguous")
          : t("applyToDay.otherDish");

  return (
    <Section title={t("applyToDay.title", { where })} description={description}>
      {!item.eaten && saved !== null && applicable && (
        <div className="flex flex-col gap-field">
          <Button
            type="button"
            className="min-h-touch self-start"
            disabled={refresh.isPending}
            aria-busy={refresh.isPending || undefined}
            onClick={() =>
              refresh.mutate(
                {
                  itemId: item.id,
                  customDishId: fittedFromRecipe ? saved.id : undefined,
                },
                {
                  onSuccess: () => {
                    toast.success(t("applyToDay.done", { where }));
                    onApplied();
                  },
                },
              )
            }
          >
            {t("applyToDay.action")}
          </Button>
          {refresh.error !== null && (
            <FormError>
              {errorMessageOf(refresh.error) ?? t("applyToDay.failed")}
            </FormError>
          )}
        </div>
      )}
    </Section>
  );
}
