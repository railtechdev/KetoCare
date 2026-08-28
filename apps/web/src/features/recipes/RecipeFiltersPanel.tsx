import { cn } from "@ketocare/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FIELD_CONTROL } from "../../components/Field";
import { RECIPE_CATEGORIES, type RecipeFilters } from "./types";

interface Props {
  filters: RecipeFilters;
  onChange: (patch: Partial<RecipeFilters>) => void;
  onReset: () => void;
  /** Начало диапазона больше конца — запрос не отправляется */
  rangeInvalid: boolean;
}

/** Фильтры списка рецептов: категория, диапазон соотношения, поиск по названию. */
export function RecipeFiltersPanel({
  filters,
  onChange,
  onReset,
  rangeInvalid,
}: Props) {
  const { t } = useTranslation("recipes");

  const ids = useId();
  const searchId = `${ids}-q`;
  const categoryId = `${ids}-category`;
  const minId = `${ids}-ratio-min`;
  const maxId = `${ids}-ratio-max`;
  const hintId = `${ids}-ratio-hint`;
  const errorId = `${ids}-ratio-error`;

  // Сообщение о неверном диапазоне связывается с обоими полями: без
  // aria-describedby пользователь скринридера не узнает, почему список пуст.
  const ratioDescribedBy = rangeInvalid ? `${hintId} ${errorId}` : hintId;

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">{t("filters.legend")}</legend>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor={searchId}
          >
            {t("filters.search")}
          </label>
          <input
            id={searchId}
            type="search"
            value={filters.q}
            placeholder={t("filters.searchPlaceholder")}
            onChange={(event) => onChange({ q: event.target.value })}
            className={FIELD_CONTROL}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor={categoryId}
          >
            {t("filters.category")}
          </label>
          <select
            id={categoryId}
            value={filters.category}
            onChange={(event) =>
              onChange({
                category: event.target.value as RecipeFilters["category"],
              })
            }
            className={FIELD_CONTROL}
          >
            <option value="">{t("filters.anyCategory")}</option>
            {RECIPE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`categories.${category}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor={minId}>
              {t("filters.ratioMin")}
            </label>
            <input
              id={minId}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={filters.ratioMin}
              aria-describedby={ratioDescribedBy}
              aria-invalid={rangeInvalid || undefined}
              onChange={(event) => onChange({ ratioMin: event.target.value })}
              className={cn(FIELD_CONTROL, "tabular-nums")}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor={maxId}>
              {t("filters.ratioMax")}
            </label>
            <input
              id={maxId}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={filters.ratioMax}
              aria-describedby={ratioDescribedBy}
              aria-invalid={rangeInvalid || undefined}
              onChange={(event) => onChange({ ratioMax: event.target.value })}
              className={cn(FIELD_CONTROL, "tabular-nums")}
            />
          </div>
        </div>
      </div>

      <p id={hintId} className="mt-2 mb-0 text-sm text-muted-foreground">
        {t("filters.ratioHint")}
      </p>

      {rangeInvalid && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 mb-0 text-sm text-destructive"
        >
          {t("filters.rangeInvalid")}
        </p>
      )}

      <button
        type="button"
        onClick={onReset}
        className="mt-3 min-h-touch rounded-lg border border-border px-4 text-foreground"
      >
        {t("filters.reset")}
      </button>
    </fieldset>
  );
}
