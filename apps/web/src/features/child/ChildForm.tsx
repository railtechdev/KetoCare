import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter } from "@ketocare/ui";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import type { Patient } from "../patients/useChildren";
import { childSchema, splitExclusions, type ChildValues } from "./childSchemas";
import { ExcludedProductsField } from "./ExcludedProductsField";

interface Props {
  /** null — заведение нового ребёнка */
  child: Patient | null;
  onSubmit: (values: ChildValues) => void;
  onCancel?: () => void;
  pending: boolean;
  error: unknown;
}

/**
 * Форма профиля ребёнка.
 *
 * При правке дата рождения и пол не показываются: сервер их не принимает, и поле,
 * которое нельзя изменить, читается как неисправность, а не как правило.
 */
export function ChildForm({
  child,
  onSubmit,
  onCancel,
  pending,
  error,
}: Props) {
  const { t } = useTranslation("child");
  const ids = useId();
  const isEdit = child !== null;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ChildValues>({
    resolver: zodResolver(childSchema),
    defaultValues: {
      fullName: child?.full_name ?? "",
      birthDate: child?.birth_date ?? "",
      sex: (child?.sex as "m" | "f") ?? "m",
      heightCm: child?.height_cm === null ? "" : String(child?.height_cm ?? ""),
      // Свободные метки — в поле, продукты каталога — списком ниже: строка
      // «3f2a…, орехи» не читается никем.
      allergies: splitExclusions(child?.allergies ?? []).labels.join(", "),
      excludedProductIds: splitExclusions(child?.allergies ?? []).productIds,
      notes: child?.notes ?? "",
    },
  });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-block"
    >
      <Field
        id={`${ids}-name`}
        width="wide"
        label={t("child.fields.fullName")}
        error={errors.fullName && t("child.errors.fullName")}
        {...register("fullName")}
      />

      {!isEdit && (
        <>
          <Field
            id={`${ids}-birth`}
            width="date"
            type="date"
            label={t("child.fields.birthDate")}
            error={errors.birthDate && t("child.errors.birthDate")}
            {...register("birthDate")}
          />
          <SelectField
            id={`${ids}-sex`}
            width="medium"
            label={t("child.fields.sex")}
            hint={t("child.immutableHint")}
            error={errors.sex && t("child.errors.sex")}
            {...register("sex")}
          >
            <option value="m">{t("child.sex.m")}</option>
            <option value="f">{t("child.sex.f")}</option>
          </SelectField>
        </>
      )}

      <Field
        id={`${ids}-height`}
        width="narrow"
        type="number"
        inputMode="decimal"
        step="0.1"
        optional
        label={t("child.fields.heightCm")}
        error={errors.heightCm && t("child.errors.heightCm")}
        {...register("heightCm")}
      />

      {/* Продукты — ссылками на каталог. Свободная строка сопоставима только
          с глазами человека: подбор раскладки и меню о ней не узнают, и
          ребёнку с аллергией на арахис решатель предложит арахисовое масло
          (раздел 6.3 ТЗ). */}
      <Controller
        control={control}
        name="excludedProductIds"
        render={({ field }) => (
          <ExcludedProductsField
            value={field.value}
            onChange={field.onChange}
            known={child?.excluded_products ?? []}
          />
        )}
      />

      <Field
        id={`${ids}-allergies`}
        width="wide"
        optional
        label={t("child.fields.allergies")}
        hint={t("child.fields.allergiesHint")}
        placeholder={t("child.fields.allergiesPlaceholder")}
        {...register("allergies")}
      />

      <TextAreaField
        id={`${ids}-notes`}
        rows={3}
        optional
        label={t("child.fields.notes")}
        {...register("notes")}
      />

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormFooter
        submitLabel={isEdit ? t("common:actions.save") : t("child.add")}
        pendingLabel={t("common:actions.saving")}
        pending={pending}
        cancelLabel={onCancel ? t("common:actions.cancel") : undefined}
        onCancel={onCancel}
      />
    </form>
  );
}
