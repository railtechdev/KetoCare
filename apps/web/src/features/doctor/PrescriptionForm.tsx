import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { FormFooter } from "@ketocare/ui";

import { Field, TextAreaField } from "../../components/Field";
import {
  FormErrorSummary,
  type FormErrorSummaryItem,
} from "../../components/FormErrorSummary";
import { FormError } from "../../components/FormError";
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
 * Поля, у которых бывает ошибка проверки: порядок повторяет порядок в форме,
 * потому что сводка читается сверху вниз вместе с ней.
 */
const VALIDATED_FIELDS = [
  { name: "ratio", anchor: "ratio", messageKey: "ratio" },
  { name: "kcalPerDay", anchor: "kcal", messageKey: "kcal" },
  { name: "proteinG", anchor: "protein", messageKey: "protein" },
  { name: "carbsLimitG", anchor: "carbs", messageKey: "carbsLimit" },
  { name: "mealsPerDay", anchor: "meals", messageKey: "meals" },
  {
    name: "effectiveFrom",
    anchor: "effective-from",
    messageKey: "effectiveFrom",
  },
] as const satisfies readonly {
  name: keyof PrescriptionFormValues;
  anchor: string;
  messageKey: string;
}[];

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
    formState: { errors, submitCount },
  } = useForm<PrescriptionFormValues>({
    resolver: zodResolver(prescriptionFormSchema),
    defaultValues,
  });

  // Сводка появляется только после неудачной отправки и повторяет тексты из-под
  // полей (правило П8 канона). Без неё врач, отправивший форму с клавиатуры,
  // оставался у кнопки внизу: назначение из шести числовых полей, и какое из
  // них не прошло, ниоткуда не следовало.
  const summary: FormErrorSummaryItem[] =
    submitCount === 0
      ? []
      : VALIDATED_FIELDS.filter(
          (field) => errors[field.name] !== undefined,
        ).map((field) => ({
          fieldId: `${ids}-${field.anchor}`,
          message: t(`prescription.errors.${field.messageKey}`),
        }));

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-block"
    >
      <FormErrorSummary
        title={t("prescription.errorSummary")}
        items={summary}
        focusKey={submitCount}
      />

      {/* Две колонки — исключение для парных числовых показателей назначения:
          врач сверяет их между собой на одном экране. На узком экране колонка
          одна (правило П6 канона). */}
      <div className="grid gap-block sm:grid-cols-2">
        <Field
          id={`${ids}-ratio`}
          width="narrow"
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
          width="narrow"
          type="number"
          inputMode="decimal"
          min={KCAL_MIN}
          max={KCAL_MAX}
          step={10}
          label={t("fields.kcal")}
          error={errors.kcalPerDay && t("prescription.errors.kcal")}
          {...register("kcalPerDay", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-protein`}
          width="narrow"
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
          width="narrow"
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
          width="narrow"
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
          width="date"
          type="date"
          label={t("fields.effectiveFrom")}
          error={errors.effectiveFrom && t("prescription.errors.effectiveFrom")}
          {...register("effectiveFrom")}
        />
      </div>

      <TextAreaField
        id={`${ids}-restrictions`}
        rows={3}
        optional
        label={t("fields.restrictions")}
        placeholder={t("prescription.restrictionsPlaceholder")}
        {...register("restrictions")}
      />

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormFooter
        submitLabel={t("prescription.submit")}
        pendingLabel={t("prescription.submitPending")}
        pending={pending}
      />
    </form>
  );
}
