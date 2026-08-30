import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormFooter, Section, toast } from "@ketocare/ui";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { optionsOfScale, useIntakeOptions } from "../intake/useIntake";
import { useSaveMedicalProfile } from "./doctorMutations";
import type { MedicalProfile, MedicalProfileBody } from "./types";

/**
 * Схема формы медицинского профиля.
 *
 * Ограничения длины остаются за сервером (`MedicalProfileWrite`): их копия здесь
 * со временем разошлась бы со схемой API. Проверяется только возраст дебюта —
 * отрицательное или дробное число месяцев не описывает ничего.
 *
 * NaN разрешён намеренно: `valueAsNumber` отдаёт его для пустого поля, а возраст
 * дебюта необязателен. Пустое значение превращается в null при отправке.
 */
const medicalProfileSchema = z.object({
  diagnosis: z.string(),
  epilepsyType: z.string(),
  onsetAgeMonths: z.number().int().min(0).or(z.nan()),
  gene: z.string(),
  variant: z.string(),
  interpretation: z.string(),
  comorbidities: z.string(),
  aedSwitchCountId: z.string(),
});

type MedicalProfileFormValues = z.infer<typeof medicalProfileSchema>;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toBody(values: MedicalProfileFormValues): MedicalProfileBody {
  const gene = emptyToNull(values.gene);
  const variant = emptyToNull(values.variant);
  const interpretation = emptyToNull(values.interpretation);

  return {
    diagnosis: emptyToNull(values.diagnosis),
    epilepsy_type: emptyToNull(values.epilepsyType),
    onset_age_months: Number.isNaN(values.onsetAgeMonths)
      ? null
      : values.onsetAgeMonths,
    // Пустая генетика уходит как null, а не как объект из трёх null: пустой
    // объект в `medical_profiles.genetics` выглядел бы как «исследование
    // проведено, находок нет».
    genetics:
      gene === null && variant === null && interpretation === null
        ? null
        : { gene, variant, interpretation },
    comorbidities: emptyToNull(values.comorbidities),
    aed_switch_count_id: emptyToNull(values.aedSwitchCountId),
  };
}

/**
 * Медицинский профиль пациента (раздел 5.3 ТЗ, `PUT /medical-profile`).
 *
 * PUT заменяет профиль целиком, поэтому форма всегда показывает все поля и
 * отправляет их вместе: частичное сохранение стёрло бы непоказанное.
 *
 * Отсюда же и число сменённых ПЭП. Семья на шаге «Лекарства» читает обещание,
 * что его заполняет врач (ADR-0007, таблица «Кто заполняет»), но поля в форме
 * не было — а раз PUT заменяет профиль целиком, любая правка диагноза ещё и
 * молча обнуляла значение, если оно попало в базу другим путём. Врач при этом
 * не видел ни прежнего значения, ни факта его потери.
 */
export function MedicalProfileForm({
  patientId,
  profile,
  onDone,
  onCancel,
}: {
  patientId: string;
  profile: MedicalProfile | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();
  const save = useSaveMedicalProfile(patientId);
  const options = useIntakeOptions();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<MedicalProfileFormValues>({
    resolver: zodResolver(medicalProfileSchema),
    defaultValues: {
      diagnosis: profile?.diagnosis ?? "",
      epilepsyType: profile?.epilepsy_type ?? "",
      // undefined, а не NaN: незаполненный возраст дебюта должен показываться
      // пустым полем, а NaN попал бы в input строкой «NaN».
      onsetAgeMonths: profile?.onset_age_months ?? undefined,
      gene: profile?.genetics?.gene ?? "",
      variant: profile?.genetics?.variant ?? "",
      interpretation: profile?.genetics?.interpretation ?? "",
      comorbidities: profile?.comorbidities ?? "",
      aedSwitchCountId: profile?.aed_switch_count_id ?? "",
    },
  });

  // Выведенный из употребления вариант остаётся в списке, пока он выбран:
  // скрыть его — значит подменить прежний ответ пустотой (то же правило, что
  // в анкете семьи, — `optionsOfScale`).
  const aedSwitchOptions = optionsOfScale(
    options.data ?? [],
    "aed_switch_count",
    watch("aedSwitchCountId"),
  );

  return (
    <Section title={t("profile.title")} description={t("profile.formHint")}>
      <form
        noValidate
        className="flex flex-col gap-block"
        onSubmit={handleSubmit((values) =>
          save.mutate(toBody(values), {
            onSuccess: () => {
              toast.success(t("profile.saved"));
              onDone();
            },
          }),
        )}
      >
        <TextAreaField
          id={`${ids}-diagnosis`}
          rows={3}
          optional
          label={t("profile.fields.diagnosis")}
          {...register("diagnosis")}
        />

        <Field
          id={`${ids}-epilepsy-type`}
          optional
          label={t("profile.fields.epilepsyType")}
          {...register("epilepsyType")}
        />

        <Field
          id={`${ids}-onset`}
          width="narrow"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          optional
          label={t("profile.fields.onset")}
          error={errors.onsetAgeMonths && t("profile.errors.onset")}
          {...register("onsetAgeMonths", { valueAsNumber: true })}
        />

        <fieldset className="m-0 flex flex-col gap-block border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold">
            {t("profile.fields.genetics")}
          </legend>

          <Field
            id={`${ids}-gene`}
            optional
            label={t("profile.fields.gene")}
            {...register("gene")}
          />
          <Field
            id={`${ids}-variant`}
            optional
            label={t("profile.fields.variant")}
            {...register("variant")}
          />
          <TextAreaField
            id={`${ids}-interpretation`}
            rows={3}
            optional
            label={t("profile.fields.interpretation")}
            {...register("interpretation")}
          />
        </fieldset>

        <TextAreaField
          id={`${ids}-comorbidities`}
          rows={3}
          optional
          label={t("profile.fields.comorbidities")}
          {...register("comorbidities")}
        />

        <SelectField
          id={`${ids}-aed-switch-count`}
          width="wide"
          optional
          label={t("profile.fields.aedSwitchCount")}
          hint={t("profile.fields.aedSwitchCountHint")}
          {...register("aedSwitchCountId")}
        >
          <option value="">{t("profile.fields.notAnswered")}</option>
          {aedSwitchOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name_ru}
            </option>
          ))}
        </SelectField>

        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={save.isPending}
          cancelLabel={t("actions.cancel")}
          onCancel={onCancel}
        />
      </form>
    </Section>
  );
}
