import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import {
  KCAL_MAX,
  KCAL_MIN,
  prescriptionFormSchema,
  RATIO_MAX,
  RATIO_MIN,
  RATIO_STEP,
  type PrescriptionFormValues,
} from "./prescriptionSchema";

/**
 * Форма назначения (раздел 8.3 ТЗ, «Врач / Назначение»).
 *
 * Границы ratio и kcal — из ТЗ и совпадают с серверной схемой. Выполнимость
 * сочетания (цель по белку против kcal/(9R+4)) проверяет сервер: это тождество
 * расчётного ядра, и вторая его реализация здесь разошлась бы с первой.
 * Поэтому ошибка сервера показывается как есть — она уже на русском.
 *
 * Ограничение «не больше трёх полей на экран» относится к формам родителя
 * (раздел 8.3 ТЗ): назначение задаёт врач за компьютером, и разрыв показателей
 * по шагам мешал бы сверять их между собой.
 */
export function PrescriptionForm({
  defaultValues,
  pending,
  error,
  onSubmit,
}: {
  defaultValues: DefaultValues<PrescriptionFormValues>;
  pending: boolean;
  /** Ошибка мутации: сообщение приходит от сервера уже на русском */
  error: unknown;
  onSubmit: (values: PrescriptionFormValues) => void;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PrescriptionFormValues>({
    resolver: zodResolver(prescriptionFormSchema),
    defaultValues,
  });

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field
          id={`${ids}-ratio`}
          type="number"
          inputMode="decimal"
          min={RATIO_MIN}
          max={RATIO_MAX}
          step={RATIO_STEP}
          label={t("fields.ratio")}
          error={errors.ratio && t("prescription.errors.ratio")}
          {...register("ratio", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-kcal`}
          type="number"
          inputMode="numeric"
          min={KCAL_MIN}
          max={KCAL_MAX}
          step={10}
          label={t("fields.kcal")}
          error={errors.kcalPerDay && t("prescription.errors.kcal")}
          {...register("kcalPerDay", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-protein`}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          label={t("fields.protein")}
          error={errors.proteinG && t("prescription.errors.protein")}
          {...register("proteinG", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-carbs`}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          label={t("fields.carbsLimit")}
          error={errors.carbsLimitG && t("prescription.errors.carbsLimit")}
          {...register("carbsLimitG", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-meals`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          label={t("fields.meals")}
          error={errors.mealsPerDay && t("prescription.errors.meals")}
          {...register("mealsPerDay", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-effective-from`}
          type="date"
          label={t("fields.effectiveFrom")}
          error={errors.effectiveFrom && t("prescription.errors.effectiveFrom")}
          {...register("effectiveFrom")}
        />
      </div>

      <TextAreaField
        id={`${ids}-restrictions`}
        rows={3}
        label={t("fields.restrictions")}
        placeholder={t("prescription.restrictionsPlaceholder")}
        {...register("restrictions")}
      />

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <SubmitButton pending={pending} className="w-auto px-6">
        {t("prescription.submit")}
      </SubmitButton>
    </form>
  );
}
