import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter } from "@ketocare/ui";
import { useId } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  FormErrorSummary,
  type FormErrorSummaryItem,
} from "../../components/FormErrorSummary";
import { SubPageHeader } from "../../components/SubPageHeader";
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
 * Поля с проверкой: якорь и ключ сообщения в одном месте.
 *
 * Сводка над формой обязана повторять текст под полем слово в слово (правило
 * П8), а порядок строк — порядок полей, поэтому и то и другое берётся отсюда, а
 * не выписывается у каждого поля заново.
 */
const VALIDATED: readonly {
  name: keyof ProductFormValues;
  /** Хвост id поля: полный id собирается с `useId()` формы */
  anchor: string;
  messageKey: string;
}[] = [
  { name: "nameRu", anchor: "name-ru", messageKey: "errors.required" },
  { name: "categoryId", anchor: "category", messageKey: "errors.categoryId" },
  ...NUTRIENTS.map((nutrient) => ({
    name: nutrient,
    anchor: nutrient,
    messageKey: "errors.number",
  })),
  { name: "source", anchor: "source", messageKey: "errors.required" },
  {
    name: "sourceVersion",
    anchor: "source-version",
    messageKey: "errors.required",
  },
  {
    name: "verifiedAt",
    anchor: "verified-at",
    messageKey: "errors.verifiedAt",
  },
];

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
    formState: { errors, submitCount },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues,
    // Правило П8: ошибка показывается по уходу с поля. При наборе граммовки
    // «0.» ещё не число, и сообщение посреди ввода только мешает.
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const activeId = `${ids}-active`;

  function fieldId(name: keyof ProductFormValues) {
    const spec = VALIDATED.find((field) => field.name === name);
    return `${ids}-${spec?.anchor ?? name}`;
  }

  function fieldError(name: keyof ProductFormValues) {
    const spec = VALIDATED.find((field) => field.name === name);
    if (spec === undefined || errors[name] === undefined) return undefined;
    return t(`products.form.${spec.messageKey}`);
  }

  // Сводка появляется только после неудачной отправки (правило П8).
  const summary: FormErrorSummaryItem[] =
    submitCount === 0
      ? []
      : VALIDATED.filter((field) => errors[field.name] !== undefined).map(
          (field) => ({
            fieldId: `${ids}-${field.anchor}`,
            message: t(`products.form.${field.messageKey}`),
          }),
        );

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-screen"
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={summary}
        focusKey={submitCount}
      />

      <SubPageHeader
        title={
          mode === "create"
            ? t("products.form.createTitle")
            : t("products.form.editTitle")
        }
      />

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <fieldset className="m-0 flex flex-col gap-block border-0 p-0">
        <legend className="mb-field text-card-title font-semibold">
          {t("products.form.names")}
        </legend>

        <Field
          id={fieldId("nameRu")}
          label={t("products.form.nameRu")}
          error={fieldError("nameRu")}
          {...register("nameRu")}
        />
        <Field
          id={`${ids}-name-uz`}
          label={t("products.form.nameUz")}
          optional
          {...register("nameUz")}
        />
        <Field
          id={`${ids}-name-en`}
          label={t("products.form.nameEn")}
          optional
          {...register("nameEn")}
        />

        <SelectField
          id={fieldId("categoryId")}
          width="medium"
          label={t("products.form.category")}
          error={fieldError("categoryId")}
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
        <legend className="mb-field text-card-title font-semibold">
          {t("products.form.nutrition")}
        </legend>

        {/* Одна колонка (правило П6): пять значений пищевой ценности — не пары
            вроде «мин/макс», и в две колонки порядок их чтения перестаёт
            совпадать с порядком колонок в источнике, откуда их переносят. */}
        <div className="flex flex-col gap-block">
          {NUTRIENTS.map((nutrient) => (
            <Field
              key={nutrient}
              id={fieldId(nutrient)}
              width="narrow"
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              label={t(`products.form.${nutrient}`)}
              error={fieldError(nutrient)}
              {...register(nutrient, { valueAsNumber: true })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-block border-0 p-0">
        <legend className="mb-field text-card-title font-semibold">
          {t("products.form.origin")}
        </legend>
        <p className="m-0 text-sm text-muted-foreground">
          {t("products.form.originHint")}
        </p>

        <Field
          id={fieldId("source")}
          label={t("products.form.source")}
          placeholder={t("products.form.sourcePlaceholder")}
          error={fieldError("source")}
          {...register("source")}
        />
        <Field
          id={fieldId("sourceVersion")}
          label={t("products.form.sourceVersion")}
          placeholder={t("products.form.sourceVersionPlaceholder")}
          error={fieldError("sourceVersion")}
          {...register("sourceVersion")}
        />
        <Field
          id={fieldId("verifiedAt")}
          width="date"
          type="date"
          label={t("products.form.verifiedAt")}
          error={fieldError("verifiedAt")}
          {...register("verifiedAt")}
        />

        {mode === "edit" && (
          <label
            htmlFor={activeId}
            className="flex min-h-touch items-center gap-field text-sm font-medium"
          >
            <input
              id={activeId}
              type="checkbox"
              className="size-5 accent-primary"
              {...register("isActive")}
            />
            {t("products.form.isActive")}
          </label>
        )}
      </fieldset>

      <FormFooter
        submitLabel={t("common:actions.save")}
        pendingLabel={t("common:actions.saving")}
        pending={pending}
        cancelLabel={t("common:actions.cancel")}
        onCancel={onCancel}
      />
    </form>
  );
}
