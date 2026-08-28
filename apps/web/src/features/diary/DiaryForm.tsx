import { zodResolver } from "@hookform/resolvers/zod";
import { WarningBanner } from "@ketocare/ui";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import type { DiaryBody, DiaryKind, DiaryLog } from "./diaryApi";
import {
  KETONE_MAX_MMOL,
  KETONE_MIN_MMOL,
  SEIZURE_COUNT_MIN,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  ketoneBody,
  ketoneSchema,
  mealBody,
  mealSchema,
  medicationBody,
  medicationSchema,
  seizureBody,
  seizureSchema,
  sideEffectBody,
  sideEffectSchema,
  weightBody,
  weightSchema,
  type KetoneValues,
  type MealValues,
  type MedicationValues,
  type SeizureValues,
  type SideEffectValues,
  type WeightValues,
} from "./schemas";
import { toDateTimeLocalInput } from "./time";
import type { DictionaryOption, MedicationOption } from "./useDiary";

interface FormCallbacks {
  /** Отправка тела запроса; onSaved вызывается после успеха — форма очищается. */
  onSubmit: (body: DiaryBody, onSaved: () => void) => void;
  onCancel: () => void;
  pending: boolean;
  error: unknown;
}

interface DiaryFormProps extends FormCallbacks {
  kind: DiaryKind;
  /** Редактируемая запись или null для новой */
  editing: DiaryLog | null;
  seizureTypes: DictionaryOption[];
  medications: MedicationOption[];
}

/**
 * Форма добавления и изменения записи дневника.
 *
 * Раздел 8.3 ТЗ: не больше трёх полей на экран. У приступа полей шесть, поэтому
 * он разбит на два шага — как и сценарий бота в разделе 7.3, где ввод тоже идёт
 * по шагам. Остальные виды укладываются в один экран.
 */
export function DiaryForm({
  kind,
  editing,
  seizureTypes,
  medications,
  ...callbacks
}: DiaryFormProps) {
  switch (kind) {
    case "seizures":
      return (
        <SeizureForm
          editing={editing?.kind === "seizures" ? editing : null}
          seizureTypes={seizureTypes}
          {...callbacks}
        />
      );
    case "ketones":
      return (
        <KetoneForm
          editing={editing?.kind === "ketones" ? editing : null}
          {...callbacks}
        />
      );
    case "weight":
      return (
        <WeightForm
          editing={editing?.kind === "weight" ? editing : null}
          {...callbacks}
        />
      );
    case "medications":
      return (
        <MedicationForm
          editing={editing?.kind === "medications" ? editing : null}
          medications={medications}
          {...callbacks}
        />
      );
    case "meals":
      return (
        <MealForm
          editing={editing?.kind === "meals" ? editing : null}
          {...callbacks}
        />
      );
    case "side-effects":
      return (
        <SideEffectForm
          editing={editing?.kind === "side-effects" ? editing : null}
          {...callbacks}
        />
      );
  }
}

function nowInput(): string {
  return toDateTimeLocalInput(new Date());
}

function occurredInput(occurredAt: string): string {
  return toDateTimeLocalInput(new Date(occurredAt));
}

function textInput(value: string | null): string {
  return value ?? "";
}

function numberInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function FormShell({
  editing,
  error,
  onSubmit,
  children,
  actions,
}: {
  editing: boolean;
  error: unknown;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useTranslation("diary");

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-kc bg-surface p-4 shadow-kc"
    >
      <h3 className="mt-0 mb-3 text-base font-semibold">
        {editing ? t("form.editTitle") : t("form.addTitle")}
      </h3>

      {children}

      {/* Сообщение сервера уже на русском (раздел 5.1 ТЗ) — свой текст запасной */}
      {error ? (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      ) : null}

      <div className="flex flex-wrap gap-3">{actions}</div>
    </form>
  );
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-touch rounded-lg border border-line px-4 font-semibold text-ink"
    >
      {children}
    </button>
  );
}

function DefaultActions({
  editing,
  pending,
  onCancel,
}: {
  editing: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation("diary");

  return (
    <>
      <SubmitButton pending={pending} className="w-auto flex-1">
        {pending ? t("form.saving") : editing ? t("form.save") : t("form.add")}
      </SubmitButton>
      {editing && (
        <SecondaryButton onClick={onCancel}>{t("form.cancel")}</SecondaryButton>
      )}
    </>
  );
}

// --- приступы -------------------------------------------------------------

function SeizureForm({
  editing,
  seizureTypes,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & {
  editing: (DiaryLog & { kind: "seizures" }) | null;
  seizureTypes: DictionaryOption[];
}) {
  const { t } = useTranslation("diary");
  const [step, setStep] = useState(1);

  const defaults = (): SeizureValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    seizureTypeId: editing?.seizure_type_id ?? "",
    durationSec: editing ? numberInput(editing.duration_sec) : "",
    count: editing ? String(editing.count) : String(SEIZURE_COUNT_MIN),
    description: editing ? textInput(editing.description) : "",
    triggers: editing ? textInput(editing.triggers) : "",
  });

  const {
    register,
    handleSubmit,
    trigger,
    reset,
    formState: { errors },
  } = useForm<SeizureValues>({
    resolver: zodResolver(seizureSchema),
    defaultValues: defaults(),
  });

  // Тип приступа приходит из справочника, а справочник семье пока не отдаётся.
  // Придумать идентификатор нельзя, поэтому новая запись недоступна; уже
  // сохранённая правится без смены типа — он уезжает на сервер прежним.
  const typesAvailable = seizureTypes.length > 0;

  if (!typesAvailable && editing === null) {
    return (
      <WarningBanner
        level="warning"
        title={t("seizures.typesUnavailable.title")}
      >
        {t("seizures.typesUnavailable.body")}
      </WarningBanner>
    );
  }

  const submit = handleSubmit((values) => {
    const body = seizureBody(values);
    if (body === null) return;
    onSubmit(body, () => {
      reset(defaults());
      setStep(1);
    });
  });

  // Второй шаг открывается только с заполненным первым: иначе ошибки первого
  // шага всплывут при отправке на экране, где этих полей не видно.
  async function goToSecondStep() {
    const valid = await trigger(["occurredAt", "seizureTypeId", "durationSec"]);
    if (valid) setStep(2);
  }

  return (
    <FormShell
      editing={editing !== null}
      error={error}
      onSubmit={submit}
      actions={
        step === 1 ? (
          <>
            <button
              type="button"
              onClick={() => void goToSecondStep()}
              className="min-h-touch flex-1 rounded-lg bg-accent px-4 font-semibold text-on-accent"
            >
              {t("form.next")}
            </button>
            {editing && (
              <SecondaryButton onClick={onCancel}>
                {t("form.cancel")}
              </SecondaryButton>
            )}
          </>
        ) : (
          <>
            <SubmitButton pending={pending} className="w-auto flex-1">
              {pending
                ? t("form.saving")
                : editing
                  ? t("form.save")
                  : t("form.add")}
            </SubmitButton>
            <SecondaryButton onClick={() => setStep(1)}>
              {t("form.back")}
            </SecondaryButton>
          </>
        )
      }
    >
      <p className="mt-0 mb-3 text-sm text-muted">
        {t("form.step", { current: step, total: 2 })}
      </p>

      <div hidden={step !== 1}>
        <Field
          id="seizure-occurred-at"
          type="datetime-local"
          label={t("form.occurredAt")}
          error={errors.occurredAt && t("form.occurredAtInvalid")}
          {...register("occurredAt")}
        />

        {typesAvailable && (
          <SelectField
            id="seizure-type"
            label={t("seizures.type")}
            error={errors.seizureTypeId && t("seizures.typeRequired")}
            {...register("seizureTypeId")}
          >
            <option value="">{t("seizures.typePlaceholder")}</option>
            {seizureTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </SelectField>
        )}

        <Field
          id="seizure-duration"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          label={t("seizures.duration")}
          error={errors.durationSec && t("seizures.durationInvalid")}
          {...register("durationSec")}
        />
      </div>

      <div hidden={step !== 2}>
        <Field
          id="seizure-count"
          type="number"
          inputMode="numeric"
          min={SEIZURE_COUNT_MIN}
          step={1}
          label={t("seizures.count")}
          error={errors.count && t("seizures.countInvalid")}
          {...register("count")}
        />
        <Field
          id="seizure-description"
          label={t("seizures.description")}
          {...register("description")}
        />
        <Field
          id="seizure-triggers"
          label={t("seizures.triggers")}
          {...register("triggers")}
        />
      </div>
    </FormShell>
  );
}

// --- кетоны ---------------------------------------------------------------

function KetoneForm({
  editing,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & { editing: (DiaryLog & { kind: "ketones" }) | null }) {
  const { t } = useTranslation("diary");

  const defaults = (): KetoneValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    value: editing ? String(editing.value) : "",
    method: editing?.method ?? "blood",
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<KetoneValues>({
    resolver: zodResolver(ketoneSchema),
    defaultValues: defaults(),
  });

  const submit = handleSubmit((values) => {
    const body = ketoneBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      editing={editing !== null}
      error={error}
      onSubmit={submit}
      actions={
        <DefaultActions
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="ketone-occurred-at"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={errors.occurredAt && t("form.occurredAtInvalid")}
        {...register("occurredAt")}
      />
      <Field
        id="ketone-value"
        type="number"
        inputMode="decimal"
        min={KETONE_MIN_MMOL}
        max={KETONE_MAX_MMOL}
        step={0.1}
        label={t("ketones.value")}
        error={
          errors.value &&
          t("ketones.valueInvalid", {
            min: KETONE_MIN_MMOL,
            max: KETONE_MAX_MMOL,
          })
        }
        {...register("value")}
      />
      <SelectField
        id="ketone-method"
        label={t("ketones.method")}
        {...register("method")}
      >
        <option value="blood">{t("ketones.methodBlood")}</option>
        <option value="urine">{t("ketones.methodUrine")}</option>
      </SelectField>
    </FormShell>
  );
}

// --- вес ------------------------------------------------------------------

function WeightForm({
  editing,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & { editing: (DiaryLog & { kind: "weight" }) | null }) {
  const { t } = useTranslation("diary");

  const defaults = (): WeightValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    weightKg: editing ? String(editing.weight_kg) : "",
    heightCm: editing ? numberInput(editing.height_cm) : "",
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WeightValues>({
    resolver: zodResolver(weightSchema),
    defaultValues: defaults(),
  });

  const submit = handleSubmit((values) => {
    const body = weightBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      editing={editing !== null}
      error={error}
      onSubmit={submit}
      actions={
        <DefaultActions
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="weight-occurred-at"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={errors.occurredAt && t("form.occurredAtInvalid")}
        {...register("occurredAt")}
      />
      <Field
        id="weight-value"
        type="number"
        inputMode="decimal"
        min={WEIGHT_MIN_KG}
        max={WEIGHT_MAX_KG}
        step={0.1}
        label={t("weight.value")}
        error={
          errors.weightKg &&
          t("weight.valueInvalid", { min: WEIGHT_MIN_KG, max: WEIGHT_MAX_KG })
        }
        {...register("weightKg")}
      />
      <Field
        id="weight-height"
        type="number"
        inputMode="decimal"
        min={1}
        step={0.5}
        label={t("weight.height")}
        error={errors.heightCm && t("weight.heightInvalid")}
        {...register("heightCm")}
      />
    </FormShell>
  );
}

// --- лекарства ------------------------------------------------------------

function MedicationForm({
  editing,
  medications,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & {
  editing: (DiaryLog & { kind: "medications" }) | null;
  medications: MedicationOption[];
}) {
  const { t } = useTranslation("diary");

  const defaults = (): MedicationValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    medicationId: editing?.medication_id ?? "",
    taken: editing?.taken ?? true,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MedicationValues>({
    resolver: zodResolver(medicationSchema),
    defaultValues: defaults(),
  });

  const submit = handleSubmit((values) => {
    const body = medicationBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  if (medications.length === 0) {
    return <p className="text-muted">{t("medications.none")}</p>;
  }

  return (
    <FormShell
      editing={editing !== null}
      error={error}
      onSubmit={submit}
      actions={
        <DefaultActions
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="medication-occurred-at"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={errors.occurredAt && t("form.occurredAtInvalid")}
        {...register("occurredAt")}
      />
      <SelectField
        id="medication-drug"
        label={t("medications.drug")}
        error={errors.medicationId && t("medications.drugRequired")}
        {...register("medicationId")}
      >
        <option value="">{t("medications.drugPlaceholder")}</option>
        {medications.map((medication) => (
          <option key={medication.id} value={medication.id}>
            {t("medications.option", {
              name: medication.drugName,
              dose: medication.dose,
            })}
          </option>
        ))}
      </SelectField>
      <label className="mb-4 flex min-h-touch items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          className="size-5 accent-accent"
          {...register("taken")}
        />
        {t("medications.taken")}
      </label>
    </FormShell>
  );
}

// --- еда ------------------------------------------------------------------

function MealForm({
  editing,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & { editing: (DiaryLog & { kind: "meals" }) | null }) {
  const { t } = useTranslation("diary");

  const defaults = (): MealValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    freeText: editing ? textInput(editing.free_text) : "",
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MealValues>({
    resolver: zodResolver(mealSchema),
    defaultValues: defaults(),
  });

  const submit = handleSubmit((values) => {
    const body = mealBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      editing={editing !== null}
      error={error}
      onSubmit={submit}
      actions={
        <DefaultActions
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="meal-occurred-at"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={errors.occurredAt && t("form.occurredAtInvalid")}
        {...register("occurredAt")}
      />
      <Field
        id="meal-free-text"
        label={t("meals.freeText")}
        placeholder={t("meals.freeTextPlaceholder")}
        error={errors.freeText && t("meals.freeTextRequired")}
        {...register("freeText")}
      />
    </FormShell>
  );
}

// --- самочувствие ---------------------------------------------------------

function SideEffectForm({
  editing,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & { editing: (DiaryLog & { kind: "side-effects" }) | null }) {
  const { t } = useTranslation("diary");

  const defaults = (): SideEffectValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    symptom: editing?.symptom ?? "",
    description: editing ? textInput(editing.description) : "",
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SideEffectValues>({
    resolver: zodResolver(sideEffectSchema),
    defaultValues: defaults(),
  });

  const submit = handleSubmit((values) => {
    const body = sideEffectBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      editing={editing !== null}
      error={error}
      onSubmit={submit}
      actions={
        <DefaultActions
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="side-effect-occurred-at"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={errors.occurredAt && t("form.occurredAtInvalid")}
        {...register("occurredAt")}
      />
      <Field
        id="side-effect-symptom"
        label={t("sideEffects.symptom")}
        placeholder={t("sideEffects.symptomPlaceholder")}
        error={errors.symptom && t("sideEffects.symptomRequired")}
        {...register("symptom")}
      />
      <Field
        id="side-effect-description"
        label={t("sideEffects.description")}
        {...register("description")}
      />
    </FormShell>
  );
}
