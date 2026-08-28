import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import { parseDateInput, toDateInput } from "../diary/time";
import type { Medication, MedicationBody } from "./types";

/**
 * Схема назначения препарата.
 *
 * Предельные длины полей остаются за сервером. Порядок дат проверяется здесь:
 * это не медицинское правило, а осмысленность отрезка приёма, и без проверки
 * врач узнавал бы об опечатке из общего «Проверьте правильность заполнения».
 */
const medicationSchema = z
  .object({
    drugName: z.string().trim().min(1),
    dose: z.string().trim().min(1),
    frequency: z.string().trim().min(1),
    startedAt: z.string().refine((value) => parseDateInput(value) !== null),
    stoppedAt: z
      .string()
      .refine((value) => value === "" || parseDateInput(value) !== null),
  })
  .refine(
    // Даты в формате YYYY-MM-DD сравниваются как строки: лексикографический
    // порядок у них совпадает с календарным, и разбор в Date не нужен.
    (values) => values.stoppedAt === "" || values.stoppedAt >= values.startedAt,
    { path: ["stoppedAt"] },
  );

type MedicationFormValues = z.infer<typeof medicationSchema>;

function toBody(values: MedicationFormValues): MedicationBody {
  return {
    drug_name: values.drugName.trim(),
    dose: values.dose.trim(),
    frequency: values.frequency.trim(),
    started_at: values.startedAt,
    stopped_at: values.stoppedAt === "" ? null : values.stoppedAt,
  };
}

/**
 * Форма схемы лекарственной терапии (раздел 5.3 ТЗ, `/medications`).
 *
 * Отмена препарата — это дата окончания, а не удаление записи: запись объясняет
 * уже сделанные отметки о приёме, и без неё дневник стал бы нечитаемым.
 */
export function MedicationForm({
  medication,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  /** null — назначение нового препарата */
  medication: Medication | null;
  pending: boolean;
  error: unknown;
  onSubmit: (body: MedicationBody) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MedicationFormValues>({
    resolver: zodResolver(medicationSchema),
    defaultValues: {
      drugName: medication?.drug_name ?? "",
      dose: medication?.dose ?? "",
      frequency: medication?.frequency ?? "",
      startedAt: medication?.started_at ?? toDateInput(new Date()),
      stoppedAt: medication?.stopped_at ?? "",
    },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => onSubmit(toBody(values)))}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field
          id={`${ids}-drug`}
          label={t("medications.fields.drugName")}
          error={errors.drugName && t("medications.errors.required")}
          {...register("drugName")}
        />
        <Field
          id={`${ids}-dose`}
          label={t("medications.fields.dose")}
          placeholder={t("medications.dosePlaceholder")}
          error={errors.dose && t("medications.errors.required")}
          {...register("dose")}
        />
        <Field
          id={`${ids}-frequency`}
          label={t("medications.fields.frequency")}
          placeholder={t("medications.frequencyPlaceholder")}
          error={errors.frequency && t("medications.errors.required")}
          {...register("frequency")}
        />
        <Field
          id={`${ids}-started`}
          type="date"
          label={t("medications.fields.startedAt")}
          error={errors.startedAt && t("medications.errors.date")}
          {...register("startedAt")}
        />
        <Field
          id={`${ids}-stopped`}
          type="date"
          label={t("medications.fields.stoppedAt")}
          error={errors.stoppedAt && t("medications.errors.stoppedAt")}
          {...register("stoppedAt")}
        />
      </div>

      <p className="mt-0 mb-4 text-sm text-muted">
        {t("medications.stoppedHint")}
      </p>

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <div className="flex flex-wrap gap-3">
        <SubmitButton pending={pending} className="w-auto px-6">
          {t("actions.save")}
        </SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch rounded-lg border border-line px-4 font-semibold"
        >
          {t("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
