import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import { productFormSchema, type ProductFormValues } from "./productSchemas";
import type { ProductCategory } from "./types";

interface Props {
  mode: "create" | "edit";
  defaultValues: DefaultValues<ProductFormValues>;
  /** Идентификаторы категорий, уже встречающиеся в справочнике — для подсказки */
  categories: readonly ProductCategory[];
  pending: boolean;
  /** Ошибка мутации: сообщение приходит от сервера уже на русском */
  error: unknown;
  onSubmit: (values: ProductFormValues) => void;
  onCancel: () => void;
}

/** Пищевая ценность на 100 г — пять одинаковых числовых полей. */
const NUTRIENTS = ["kcal", "fat", "protein", "carbs", "fiber"] as const;

/**
 * Карточка продукта (раздел 8.3 ТЗ, «Админ / Продукты»).
 *
 * Ограничение «не больше трёх полей на экран» относится к формам родителя
 * (раздел 8.3 ТЗ). Здесь поля сгруппированы по смыслу: продукт заводит
 * администратор за компьютером, сверяя всю карточку с источником целиком, и
 * разбиение на шаги мешало бы сверке.
 */
export function ProductForm({
  mode,
  defaultValues,
  categories,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation("admin");
  const ids = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues,
  });

  const activeId = `${ids}-active`;

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
    >
      <h2 className="m-0 text-lg font-semibold">
        {mode === "create"
          ? t("products.form.createTitle")
          : t("products.form.editTitle")}
      </h2>

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-base font-semibold">
          {t("products.form.names")}
        </legend>

        <Field
          id={`${ids}-name-ru`}
          label={t("products.form.nameRu")}
          error={errors.nameRu && t("products.form.errors.required")}
          {...register("nameRu")}
        />
        <Field
          id={`${ids}-name-uz`}
          label={t("products.form.nameUz")}
          {...register("nameUz")}
        />
        <Field
          id={`${ids}-name-en`}
          label={t("products.form.nameEn")}
          {...register("nameEn")}
        />

        <SelectField
          id={`${ids}-category`}
          label={t("products.form.category")}
          error={errors.categoryId && t("products.form.errors.categoryId")}
          {...register("categoryId")}
        >
          <option value="">{t("products.form.categoryPlaceholder")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name_ru}
            </option>
          ))}
        </SelectField>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-base font-semibold">
          {t("products.form.nutrition")}
        </legend>

        <div className="grid gap-x-4 sm:grid-cols-2">
          {NUTRIENTS.map((nutrient) => (
            <Field
              key={nutrient}
              id={`${ids}-${nutrient}`}
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              label={t(`products.form.${nutrient}`)}
              error={errors[nutrient] && t("products.form.errors.number")}
              {...register(nutrient, { valueAsNumber: true })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-base font-semibold">
          {t("products.form.origin")}
        </legend>
        <p className="mt-0 mb-3 text-sm text-muted">
          {t("products.form.originHint")}
        </p>

        <Field
          id={`${ids}-source`}
          label={t("products.form.source")}
          placeholder={t("products.form.sourcePlaceholder")}
          error={errors.source && t("products.form.errors.required")}
          {...register("source")}
        />
        <Field
          id={`${ids}-source-version`}
          label={t("products.form.sourceVersion")}
          placeholder={t("products.form.sourceVersionPlaceholder")}
          error={errors.sourceVersion && t("products.form.errors.required")}
          {...register("sourceVersion")}
        />
        <Field
          id={`${ids}-verified-at`}
          type="date"
          label={t("products.form.verifiedAt")}
          error={errors.verifiedAt && t("products.form.errors.verifiedAt")}
          {...register("verifiedAt")}
        />

        {mode === "edit" && (
          <label
            htmlFor={activeId}
            className="mb-4 flex min-h-touch items-center gap-3 text-sm font-medium"
          >
            <input
              id={activeId}
              type="checkbox"
              className="size-5 accent-accent"
              {...register("isActive")}
            />
            {t("products.form.isActive")}
          </label>
        )}
      </fieldset>

      <div className="flex gap-3">
        <SubmitButton pending={pending} className="max-w-48">
          {t("common:actions.save")}
        </SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch max-w-48 flex-1 rounded-lg border border-line px-4 text-ink"
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    </form>
  );
}
