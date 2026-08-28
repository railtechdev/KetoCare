import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useFieldArray, useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import { ProductPicker } from "../calculator/ProductPicker";
import { recipeFormSchema, type RecipeFormValues } from "./schemas";
import { RECIPE_CATEGORIES } from "./types";

interface Props {
  mode: "create" | "edit";
  defaultValues: DefaultValues<RecipeFormValues>;
  pending: boolean;
  /** Ошибка мутации: сообщение приходит от сервера уже на русском */
  error: unknown;
  onSubmit: (values: RecipeFormValues) => void;
  onCancel: () => void;
}

/**
 * Форма рецепта для admin/dietitian (раздел 5.3 ТЗ).
 *
 * Ограничение «не больше трёх полей на экран» относится к формам родителя
 * (раздел 8.3 ТЗ), поэтому здесь поля сгруппированы по смыслу, а не разбиты на
 * шаги: рецепт заполняет специалист за компьютером, и разрыв состава по шагам
 * мешал бы сверять его целиком.
 */
export function RecipeForm({
  mode,
  defaultValues,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation("recipes");
  const ids = useId();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues,
  });

  const ingredients = useFieldArray({ control, name: "ingredients" });

  const categoryId = `${ids}-category`;
  const instructionsId = `${ids}-instructions`;
  const compositionErrorId = `${ids}-composition-error`;

  const compositionEmpty = ingredients.fields.length === 0;

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
    >
      <h1 className="m-0 text-xl font-semibold">
        {mode === "create" ? t("form.createTitle") : t("form.editTitle")}
      </h1>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-lg font-semibold">
          {t("form.basics")}
        </legend>

        <Field
          id={`${ids}-title`}
          label={t("form.title")}
          placeholder={t("form.titlePlaceholder")}
          error={errors.title && t("form.errors.title")}
          {...register("title")}
        />

        <SelectField
          id={categoryId}
          label={t("form.category")}
          error={errors.category && t("form.errors.category")}
          {...register("category")}
        >
          {RECIPE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </SelectField>

        <Field
          id={`${ids}-photo`}
          label={t("form.photoPath")}
          {...register("photoPath")}
        />
        <p className="mt-0 mb-4 text-sm text-muted-foreground">
          {t("form.photoHint")}
        </p>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-lg font-semibold">
          {t("form.portion")}
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${ids}-yield`}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            label={t("form.yieldG")}
            error={errors.yieldG && t("form.errors.yieldG")}
            {...register("yieldG", { valueAsNumber: true })}
          />
          <Field
            id={`${ids}-servings`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            label={t("form.servings")}
            error={errors.servings && t("form.errors.servings")}
            {...register("servings", { valueAsNumber: true })}
          />
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-lg font-semibold">
          {t("form.composition")}
        </legend>

        {/* Enter в поле поиска не должен отправлять форму: подбирая продукт,
            редактор сохранил бы наполовину заполненный рецепт. Сам выбор из
            списка ProductPicker обрабатывает раньше, на своём input. */}
        <div
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        >
          <ProductPicker
            excludeIds={ingredients.fields.map((field) => field.productId)}
            onPick={(product) =>
              ingredients.append({
                productId: product.id,
                name: product.name,
                grams: 50,
              })
            }
          />
        </div>

        {compositionEmpty ? (
          <p className="mt-3 mb-0 text-muted-foreground">
            {t("form.emptyComposition")}
          </p>
        ) : (
          <ul className="mt-3 mb-0 flex list-none flex-col gap-2 p-0">
            {ingredients.fields.map((field, index) => {
              const gramsId = `${ids}-grams-${field.id}`;
              const gramsError = errors.ingredients?.[index]?.grams;

              return (
                <li
                  key={field.id}
                  className="flex flex-wrap items-center gap-3"
                >
                  <span className="flex-1">{field.name}</span>

                  <label className="sr-only" htmlFor={gramsId}>
                    {t("form.grams", { name: field.name })}
                  </label>
                  <input
                    id={gramsId}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.1}
                    aria-invalid={gramsError ? true : undefined}
                    aria-describedby={
                      gramsError ? `${gramsId}-error` : undefined
                    }
                    className="min-h-touch w-24 rounded-lg border border-border bg-card px-3 py-2 text-right tabular-nums"
                    {...register(`ingredients.${index}.grams`, {
                      valueAsNumber: true,
                    })}
                  />
                  <span className="text-muted-foreground">
                    {t("form.gramsUnit")}
                  </span>

                  <button
                    type="button"
                    onClick={() => ingredients.remove(index)}
                    aria-label={t("form.removeIngredient", {
                      name: field.name,
                    })}
                    className="min-h-touch min-w-touch rounded-lg border border-border px-3 text-foreground"
                  >
                    ×
                  </button>

                  {gramsError && (
                    <p
                      id={`${gramsId}-error`}
                      className="w-full text-sm text-destructive"
                    >
                      {t("form.errors.grams")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {compositionEmpty && errors.ingredients && (
          <p
            id={compositionErrorId}
            role="alert"
            className="mt-2 mb-0 text-sm text-destructive"
          >
            {t("form.errors.ingredients")}
          </p>
        )}

        <p className="mt-2 mb-0 text-sm text-muted-foreground">
          {t("form.computedHint")}
        </p>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-lg font-semibold">
          {t("form.cooking")}
        </legend>

        <TextAreaField
          id={instructionsId}
          label={t("form.instructions")}
          rows={8}
          placeholder={t("form.instructionsPlaceholder")}
          error={errors.instructions && t("form.errors.instructions")}
          {...register("instructions")}
        />
      </fieldset>

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} className="w-full max-w-xs">
          {pending
            ? t("form.submitting")
            : mode === "create"
              ? t("form.submitCreate")
              : t("form.submitEdit")}
        </SubmitButton>

        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch rounded-lg border border-border px-4 text-foreground"
        >
          {t("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
