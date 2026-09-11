import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormFooter } from "@ketocare/ui";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { parseDateInput, toDateInput } from "../diary/time";
import { useAedDrugs } from "../intake/useIntake";
import { DrugNameField } from "./DrugNameField";
import {
  MEDICATION_FREQUENCIES,
  isMedicationFrequency,
} from "./medicationFrequency";
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
    // Кратность — из списка (ADR-0033). Пустой выбор — строка, а не значение
    // перечисления: так форма отличает «не выбрано» от выбранного.
    // Проверка с явным `boolean`, а не охранник типа: охранник (и стрелка, из
    // которой TypeScript выводит его сам) сузил бы тип значения формы до
    // перечисления, и пустой выбор по умолчанию перестал бы им быть.
    frequencyCode: z
      .string()
      .refine((value): boolean => isMedicationFrequency(value)),
    frequency: z.string(),
    startedAt: z.string().refine((value) => parseDateInput(value) !== null),
    stoppedAt: z
      .string()
      .refine((value) => value === "" || parseDateInput(value) !== null),
  })
  .refine(
    // «Другая схема» без слов не говорит, как давать препарат. Сервер
    // проверяет то же; здесь — чтобы ошибка встала у поля, а не общей строкой.
    (values) =>
      values.frequencyCode !== "other" || values.frequency.trim() !== "",
    { path: ["frequency"] },
  )
  .refine(
    // Даты в формате YYYY-MM-DD сравниваются как строки: лексикографический
    // порядок у них совпадает с календарным, и разбор в Date не нужен.
    (values) => values.stoppedAt === "" || values.stoppedAt >= values.startedAt,
    { path: ["stoppedAt"] },
  );

type MedicationFormValues = z.infer<typeof medicationSchema>;

/**
 * Порядок полей на экране — он же порядок, в котором ищется первая ошибка.
 *
 * Список явный, потому что вывести его неоткуда: `react-hook-form` знает
 * порядок регистрации (у `Controller` он другой), а zod — порядок объявления
 * схемы, который с разметкой совпадать не обязан.
 */
export const FIELD_ORDER = [
  "drugName",
  "dose",
  "frequencyCode",
  "frequency",
  "startedAt",
  "stoppedAt",
] as const satisfies readonly (keyof MedicationFormValues)[];

function toBody(values: MedicationFormValues): MedicationBody {
  // Схема уже проверила код; сужение нужно типам, а не данным.
  if (!isMedicationFrequency(values.frequencyCode)) {
    throw new Error(`Unknown frequency code: ${values.frequencyCode}`);
  }
  const note = values.frequency.trim();

  return {
    drug_name: values.drugName.trim(),
    dose: values.dose.trim(),
    frequency_code: values.frequencyCode,
    frequency: note === "" ? null : note,
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
  suggestedDrugName,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  /** null — назначение нового препарата */
  medication: Medication | null;
  /**
   * Название, названное семьёй в анкете.
   *
   * Только подстановка в поле: дозу и режим приёма назначает врач, и
   * переносить их из анкеты нечего — их там нет. Решение остаётся за
   * человеком (правило «человек в контуре»).
   */
  suggestedDrugName?: string;
  pending: boolean;
  error: unknown;
  onSubmit: (body: MedicationBody) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("doctor");
  const ids = useId();
  // Запись, заведённая до списка: кратность у неё словами, кода нет. Слова
  // встают в уточнение, а код выбирает врач — угадывать его по строке нельзя.
  const legacy =
    medication !== null &&
    (medication.frequency_code === null ||
      medication.frequency_code === undefined);

  // Справочник тот же, что у анкеты семьи, и ключ у запроса общий: карта
  // пациента почти всегда уже показала анкету, поэтому список приходит из кэша.
  const drugs = useAedDrugs();

  const {
    register,
    control,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<MedicationFormValues>({
    resolver: zodResolver(medicationSchema),
    // Свой фокус вместо встроенного: встроенный обходит поля в порядке
    // РЕГИСТРАЦИИ и отрабатывает ПОСЛЕ обработчика ошибок, то есть
    // перебивает его. Порядок регистрации здесь не совпадает с экранным —
    // поле препарата идёт через `Controller` и регистрируется позже соседей.
    shouldFocusError: false,
    defaultValues: {
      drugName: medication?.drug_name ?? suggestedDrugName ?? "",
      dose: medication?.dose ?? "",
      frequencyCode: medication?.frequency_code ?? "",
      frequency: medication?.frequency ?? "",
      startedAt: medication?.started_at ?? toDateInput(new Date()),
      stoppedAt: medication?.stopped_at ?? "",
    },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit(
        (values) => onSubmit(toBody(values)),
        // Фокус — на ПЕРВОЕ незаполненное поле формы, а не на первое, до
        // которого дошёл react-hook-form. Он обходит поля в порядке
        // РЕГИСТРАЦИИ, а поле препарата регистрируется через `Controller`, то
        // есть позже соседей: на пустой форме фокус вставал на дозу, и человек
        // с клавиатуры узнавал не о той ошибке. Порядок берётся у схемы —
        // zod отдаёт ошибки в порядке объявления полей.
        (invalid) => {
          const first = FIELD_ORDER.find((field) => field in invalid);
          if (first !== undefined) setFocus(first);
        },
      )}
      className="flex flex-col gap-block"
    >
      <div className="grid gap-block sm:grid-cols-2">
        {/* Поле остаётся текстовым: справочник неполон, и закрывать список
            нельзя — врач назначает и то, чего в нём нет. */}
        <Controller
          control={control}
          name="drugName"
          render={({ field }) => (
            <DrugNameField
              id={`${ids}-drug`}
              name={field.name}
              label={t("medications.fields.drugName")}
              error={errors.drugName && t("medications.errors.required")}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              // Без ссылки на поле react-hook-form не находит, куда ставить
              // фокус после неудачной отправки, и уводит его на следующую
              // ошибку — то есть человек узнаёт не о той.
              inputRef={field.ref}
              drugs={drugs.data ?? []}
            />
          )}
        />
        {/* Доза — свободная строка, и единицу подсказывает пояснение, а не
            подпись поля. Заказчица написала «мг/сут», но у сиропов миллилитры,
            у АКТГ единицы действия, у части схем мг/кг/сут: зашитая единица
            сделала бы часть карт неверными МОЛЧА. Вопрос 44 медкоманде. */}
        <Field
          id={`${ids}-dose`}
          label={t("medications.fields.dose")}
          placeholder={t("medications.dosePlaceholder")}
          hint={t("medications.doseHint")}
          error={errors.dose && t("medications.errors.required")}
          {...register("dose")}
        />
        {/* Список, а не строка: одно и то же назначение, записанное по-разному,
            нельзя ни сравнить, ни посчитать (вопрос 45 медкоманде). Значения —
            коды кратности HL7 FHIR, ADR-0033. */}
        <SelectField
          id={`${ids}-frequency-code`}
          label={t("medications.fields.frequency")}
          hint={legacy ? t("medications.frequencyLegacyHint") : undefined}
          error={errors.frequencyCode && t("medications.errors.frequencyCode")}
          {...register("frequencyCode")}
        >
          <option value="">{t("medications.frequencyNotSet")}</option>
          {MEDICATION_FREQUENCIES.map((code) => (
            <option key={code} value={code}>
              {t(`medications.frequencyCodes.${code}`)}
            </option>
          ))}
        </SelectField>
        <Field
          id={`${ids}-frequency`}
          optional
          label={t("medications.fields.frequencyNote")}
          placeholder={t("medications.frequencyNotePlaceholder")}
          hint={t("medications.frequencyNoteHint")}
          error={errors.frequency && t("medications.errors.frequencyNote")}
          {...register("frequency")}
        />
        <Field
          id={`${ids}-started`}
          width="date"
          type="date"
          label={t("medications.fields.startedAt")}
          error={errors.startedAt && t("medications.errors.date")}
          {...register("startedAt")}
        />
        <Field
          id={`${ids}-stopped`}
          width="date"
          type="date"
          optional
          label={t("medications.fields.stoppedAt")}
          hint={t("medications.stoppedHint")}
          error={errors.stoppedAt && t("medications.errors.stoppedAt")}
          {...register("stoppedAt")}
        />
      </div>

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormFooter
        submitLabel={t("actions.save")}
        pendingLabel={t("common:actions.saving")}
        pending={pending}
        cancelLabel={t("actions.cancel")}
        onCancel={onCancel}
      />
    </form>
  );
}
