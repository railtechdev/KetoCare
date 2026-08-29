import { Button, Section } from "@ketocare/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
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
    // Блок фильтров без видимой подписи: он узнаётся по содержимому, а
    // заголовок нужен только скринридеру (правила П23, П27).
    <Section
      title={t("filters.legend")}
      titleHidden
      density="compact"
      contentClassName="gap-field"
    >
      <div className="grid gap-block sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Field
            id={searchId}
            type="search"
            label={t("filters.search")}
            placeholder={t("filters.searchPlaceholder")}
            value={filters.q}
            onChange={(event) => onChange({ q: event.target.value })}
          />
        </div>

        <SelectField
          id={categoryId}
          label={t("filters.category")}
          value={filters.category}
          onChange={(event) =>
            onChange({
              category: event.target.value as RecipeFilters["category"],
            })
          }
        >
          <option value="">{t("filters.anyCategory")}</option>
          {RECIPE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </SelectField>

        {/* Границы диапазона — единственная пара полей, которую канон
                разрешает ставить в две колонки (правило П6). */}
        <div className="grid grid-cols-2 gap-block">
          <Field
            id={minId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            label={t("filters.ratioMin")}
            value={filters.ratioMin}
            aria-describedby={ratioDescribedBy}
            aria-invalid={rangeInvalid || undefined}
            onChange={(event) => onChange({ ratioMin: event.target.value })}
            className="tabular-nums"
          />
          <Field
            id={maxId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            label={t("filters.ratioMax")}
            value={filters.ratioMax}
            aria-describedby={ratioDescribedBy}
            aria-invalid={rangeInvalid || undefined}
            onChange={(event) => onChange({ ratioMax: event.target.value })}
            className="tabular-nums"
          />
        </div>
      </div>

      <p id={hintId} className="mt-field mb-0 text-sm text-muted-foreground">
        {t("filters.ratioHint")}
      </p>

      {rangeInvalid && (
        <p
          id={errorId}
          role="alert"
          className="mt-field mb-0 text-sm text-destructive"
        >
          {t("filters.rangeInvalid")}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        className="mt-block min-h-touch"
        onClick={onReset}
      >
        {t("filters.reset")}
      </Button>
    </Section>
  );
}
