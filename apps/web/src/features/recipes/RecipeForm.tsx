import { zodResolver } from "@hookform/resolvers/zod";
import { Button, EmptyState, FormFooter, Input } from "@ketocare/ui";
import { CookingPot, X } from "lucide-react";
import { useId } from "react";
import { useFieldArray, useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
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
    <PageLayout
      title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
      width="form"
      onBack={onCancel}
    >
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-screen"
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
            {t("form.basics")}
          </legend>

          <div className="flex flex-col gap-block">
            <Field
              id={`${ids}-title`}
              label={t("form.title")}
              placeholder={t("form.titlePlaceholder")}
              error={errors.title && t("form.errors.title")}
              {...register("title")}
            />

            <SelectField
              id={categoryId}
              width="medium"
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
              optional
              hint={t("form.photoHint")}
              {...register("photoPath")}
            />
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
            {t("form.portion")}
          </legend>

          <div className="grid gap-block sm:grid-cols-2">
            <Field
              id={`${ids}-yield`}
              width="narrow"
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
              width="narrow"
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
          <legend className="mb-block text-card-title font-semibold">
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
            <EmptyState
              icon={CookingPot}
              title={t("form.emptyCompositionTitle")}
              description={t("form.emptyComposition")}
              className="mt-block"
            />
          ) : (
            <ul className="mt-block mb-0 flex list-none flex-col gap-field p-0">
              {ingredients.fields.map((field, index) => {
                const gramsId = `${ids}-grams-${field.id}`;
                const gramsError = errors.ingredients?.[index]?.grams;

                return (
                  <li
                    key={field.id}
                    className="flex flex-wrap items-center gap-block"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {field.name}
                    </span>

                    <label className="sr-only" htmlFor={gramsId}>
                      {t("form.grams", { name: field.name })}
                    </label>
                    <Input
                      id={gramsId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      aria-invalid={gramsError ? true : undefined}
                      aria-describedby={
                        gramsError ? `${gramsId}-error` : undefined
                      }
                      className="min-h-touch w-24 text-right tabular-nums"
                      {...register(`ingredients.${index}.grams`, {
                        valueAsNumber: true,
                      })}
                    />
                    <span className="text-muted-foreground">
                      {t("form.gramsUnit")}
                    </span>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="min-h-touch min-w-touch"
                      aria-label={t("form.removeIngredient", {
                        name: field.name,
                      })}
                      onClick={() => ingredients.remove(index)}
                    >
                      <X aria-hidden="true" />
                    </Button>

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
              className="mt-field mb-0 text-sm text-destructive"
            >
              {t("form.errors.ingredients")}
            </p>
          )}

          <p className="mt-field mb-0 text-sm text-muted-foreground">
            {t("form.computedHint")}
          </p>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
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

        <FormFooter
          submitLabel={
            mode === "create" ? t("form.submitCreate") : t("form.submitEdit")
          }
          pendingLabel={t("form.submitting")}
          pending={pending}
          cancelLabel={t("actions.cancel")}
          onCancel={onCancel}
        />
      </form>
    </PageLayout>
  );
}
