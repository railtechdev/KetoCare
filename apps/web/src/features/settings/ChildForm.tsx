import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import type { Patient } from "../patients/useChildren";
import { childSchema, type ChildValues } from "./childSchemas";

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
  const { t } = useTranslation("settings");
  const ids = useId();
  const isEdit = child !== null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChildValues>({
    resolver: zodResolver(childSchema),
    defaultValues: {
      fullName: child?.full_name ?? "",
      birthDate: child?.birth_date ?? "",
      sex: (child?.sex as "m" | "f") ?? "m",
      heightCm: child?.height_cm === null ? "" : String(child?.height_cm ?? ""),
      allergies: (child?.allergies ?? []).join(", "),
      notes: child?.notes ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-xl">
      <Field
        id={`${ids}-name`}
        label={t("child.fields.fullName")}
        error={errors.fullName && t("child.errors.fullName")}
        {...register("fullName")}
      />

      {!isEdit && (
        <>
          <Field
            id={`${ids}-birth`}
            type="date"
            label={t("child.fields.birthDate")}
            error={errors.birthDate && t("child.errors.birthDate")}
            {...register("birthDate")}
          />
          <SelectField
            id={`${ids}-sex`}
            label={t("child.fields.sex")}
            error={errors.sex && t("child.errors.sex")}
            {...register("sex")}
          >
            <option value="m">{t("child.sex.m")}</option>
            <option value="f">{t("child.sex.f")}</option>
          </SelectField>
          <p className="mt-0 mb-4 text-sm text-muted-foreground">
            {t("child.immutableHint")}
          </p>
        </>
      )}

      <Field
        id={`${ids}-height`}
        type="number"
        inputMode="decimal"
        step="0.1"
        label={t("child.fields.heightCm")}
        error={errors.heightCm && t("child.errors.heightCm")}
        {...register("heightCm")}
      />

      <Field
        id={`${ids}-allergies`}
        label={t("child.fields.allergies")}
        placeholder={t("child.fields.allergiesPlaceholder")}
        {...register("allergies")}
      />

      <TextAreaField
        id={`${ids}-notes`}
        rows={3}
        label={t("child.fields.notes")}
        {...register("notes")}
      />

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <div className="flex flex-wrap gap-3">
        <SubmitButton pending={pending}>
          {isEdit ? t("common:actions.save") : t("child.add")}
        </SubmitButton>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-touch rounded-lg border border-border px-4 text-foreground"
          >
            {t("common:actions.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
