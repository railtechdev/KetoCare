import { zodResolver } from "@hookform/resolvers/zod";
import {
  EmptyState,
  FormFooter,
  WarningBanner,
  formatMeasured,
  formatWeight,
  OCCURRED_AT_FUTURE,
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
  toDateTimeLocalInput,
  weightBody,
  weightSchema,
  type KetoneValues,
  type MealValues,
  type MedicationValues,
  type SeizureValues,
  type SideEffectValues,
  type WeightValues,
} from "@ketocare/ui";
import { Pill } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
  type FormErrorSummaryItem,
} from "../../components/FormErrorSummary";
import { errorMessageOf } from "../../lib/api";
import type { DiaryBody, DiaryKind, DiaryLog } from "./diaryApi";
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
  durationOptions: DictionaryOption[];
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
  durationOptions,
  medications,
  ...callbacks
}: DiaryFormProps) {
  switch (kind) {
    case "seizures":
      return (
        <SeizureForm
          editing={editing?.kind === "seizures" ? editing : null}
          seizureTypes={seizureTypes}
          durationOptions={durationOptions}
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

/**
 * Текст ошибки поля «когда» — один на все шесть форм.
 *
 * Причины две, и лечатся они по-разному: неразобранное значение надо ввести, а
 * время, которое ещё не наступило, — исправить. Сервер на запись из будущего
 * отвечает общим «проверьте поля», поэтому причину называет форма. Пока выбор
 * жил в одной форме, пять остальных, включая кетоны и вес, на будущую дату
 * писали «укажите дату» у уже заполненного поля.
 */
function occurredAtErrorKey(
  message: string | undefined,
): "form.occurredAtFuture" | "form.occurredAtInvalid" {
  return message === OCCURRED_AT_FUTURE
    ? "form.occurredAtFuture"
    : "form.occurredAtInvalid";
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

/**
 * Оболочка формы записи.
 *
 * Своей рамки и заголовка у неё нет: форма живёт в панели, открытой действием
 * шапки, и заголовок даёт панель. Раньше форма стояла раскрытой над списком и
 * занимала 58 % высоты экрана — родитель приходил посмотреть записи, а получал
 * ввод (правило П32, `docs/AUDIT_UI_LAYOUT.md`).
 */
function FormShell({
  description,
  summary,
  focusKey,
  error,
  onSubmit,
  children,
  footer,
}: {
  description?: ReactNode;
  /** Сводка ошибок после неудачной отправки (правило П8) */
  summary: readonly FormErrorSummaryItem[];
  /** Счётчик отправок: по нему сводка забирает фокус */
  focusKey: number;
  error: unknown;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { t } = useTranslation("diary");

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-section">
      {description && (
        <p className="m-0 text-sm text-muted-foreground">{description}</p>
      )}

      <FormErrorSummary items={summary} focusKey={focusKey} />

      {children}

      {/* Сообщение сервера уже на русском (раздел 5.1 ТЗ) — свой текст запасной */}
      {error ? (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      ) : null}

      {footer}
    </form>
  );
}

function DefaultFooter({
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
    <FormFooter
      submitLabel={editing ? t("form.save") : t("form.add")}
      pendingLabel={t("form.saving")}
      pending={pending}
      cancelLabel={editing ? t("form.cancel") : undefined}
      onCancel={editing ? onCancel : undefined}
    />
  );
}

// --- приступы -------------------------------------------------------------

function SeizureForm({
  editing,
  seizureTypes,
  durationOptions,
  onSubmit,
  onCancel,
  pending,
  error,
}: FormCallbacks & {
  editing: (DiaryLog & { kind: "seizures" }) | null;
  seizureTypes: DictionaryOption[];
  durationOptions: DictionaryOption[];
}) {
  const { t } = useTranslation("diary");
  const [step, setStep] = useState(1);
  /**
   * Неудачные попытки перейти ко второму шагу. Переход проверяет поля через
   * `trigger`, а не через отправку, и `submitCount` его не считает — без этого
   * счётчика сводка ошибок первого шага не появлялась бы никогда.
   */
  const [stepAttempts, setStepAttempts] = useState(0);

  const defaults = (): SeizureValues => ({
    occurredAt: editing ? occurredInput(editing.occurred_at) : nowInput(),
    seizureTypeId: editing?.seizure_type_id ?? "",
    durationSec: editing ? numberInput(editing.duration_sec) : "",
    durationOptionId: editing?.duration_option_id ?? "",
    count: editing ? String(editing.count) : String(SEIZURE_COUNT_MIN),
    description: editing ? textInput(editing.description) : "",
    triggers: editing ? textInput(editing.triggers) : "",
  });

  const {
    register,
    handleSubmit,
    trigger,
    reset,
    formState: { errors, submitCount },
  } = useForm<SeizureValues>({
    resolver: zodResolver(seizureSchema),
    defaultValues: defaults(),
  });

  const occurredAtError =
    errors.occurredAt && t(occurredAtErrorKey(errors.occurredAt.message));
  const typeError = errors.seizureTypeId && t("seizures.typeRequired");
  const durationError = errors.durationSec && t("seizures.durationInvalid");
  const durationOptionError =
    errors.durationOptionId && t("seizures.durationBothInvalid");
  const countError = errors.count && t("seizures.countInvalid");

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
    else setStepAttempts((current) => current + 1);
  }

  // Подвал у обоих шагов один и тот же (FormFooter отправляет форму), поэтому
  // смысл отправки задаётся здесь: на первом шаге это переход ко второму.
  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (step === 1) {
      event.preventDefault();
      void goToSecondStep();
      return;
    }
    void submit(event);
  }

  return (
    <FormShell
      summary={errorSummaryItems(submitCount + stepAttempts, [
        ["seizure-occurred-at", occurredAtError],
        ["seizure-type", typeError],
        ["seizure-duration", durationError],
        ["seizure-duration-option", durationOptionError],
        ["seizure-count", countError],
      ])}
      focusKey={submitCount + stepAttempts}
      description={t("form.step", { current: step, total: 2 })}
      error={error}
      onSubmit={handleFormSubmit}
      footer={
        step === 1 ? (
          <FormFooter
            submitLabel={t("form.next")}
            pendingLabel={t("form.next")}
            cancelLabel={editing ? t("form.cancel") : undefined}
            onCancel={editing ? onCancel : undefined}
          />
        ) : (
          <FormFooter
            submitLabel={editing ? t("form.save") : t("form.add")}
            pendingLabel={t("form.saving")}
            pending={pending}
            cancelLabel={t("form.back")}
            onCancel={() => setStep(1)}
          />
        )
      }
    >
      {/* Скрытый шаг убирается из потока классом, а не атрибутом hidden:
          утилита flex у соседнего шага перебила бы его display:none. */}
      <div className={step === 1 ? "flex flex-col gap-section" : "hidden"}>
        <Field
          id="seizure-occurred-at"
          width="medium"
          type="datetime-local"
          label={t("form.occurredAt")}
          error={occurredAtError}
          {...register("occurredAt")}
        />

        {typesAvailable && (
          <SelectField
            id="seizure-type"
            // Во всю ширину панели: названия типов по ILAE длинные, и в
            // средней ширине выбранное значение обрезалось на полуслове.
            width="full"
            label={t("seizures.type")}
            error={typeError}
            {...register("seizureTypeId")}
          >
            <option value="">{t("seizures.typePlaceholder")}</option>
            {/* Выведенный тип предлагается только записи, которая на нём уже
                стоит: новый приступ записывается по ILAE 2025 (ADR-0050). */}
            {seizureTypes
              .filter(
                (type) => !type.retired || type.id === editing?.seizure_type_id,
              )
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.retired
                    ? t("seizures.retiredType", { name: type.name })
                    : type.name}
                </option>
              ))}
          </SelectField>
        )}

        <Field
          id="seizure-duration"
          width="narrow"
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          optional
          label={t("seizures.duration")}
          hint={t("seizures.durationHint")}
          error={durationError}
          {...register("durationSec")}
        />

        {/* Интервал со слов — та же шкала, что у анкеты и у бота. Без него
            кабинет умел бы только секунды, и семья отвечала бы на один вопрос
            двумя способами: в чате интервалом, здесь числом. */}
        <SelectField
          id="seizure-duration-option"
          // «Выберите ин…» в узкой ширине — значит, выбор не прочесть.
          width="full"
          optional
          label={t("seizures.durationChoice")}
          error={durationOptionError}
          {...register("durationOptionId")}
        >
          <option value="">{t("seizures.durationChoicePlaceholder")}</option>
          {durationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className={step === 2 ? "flex flex-col gap-section" : "hidden"}>
        <Field
          id="seizure-count"
          width="tiny"
          type="number"
          inputMode="decimal"
          min={SEIZURE_COUNT_MIN}
          step={1}
          label={t("seizures.count")}
          error={countError}
          {...register("count")}
        />
        <TextAreaField
          id="seizure-description"
          rows={3}
          optional
          label={t("seizures.description")}
          {...register("description")}
        />
        <TextAreaField
          id="seizure-triggers"
          rows={2}
          optional
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
    formState: { errors, submitCount },
  } = useForm<KetoneValues>({
    resolver: zodResolver(ketoneSchema),
    defaultValues: defaults(),
  });

  const occurredAtError =
    errors.occurredAt && t(occurredAtErrorKey(errors.occurredAt.message));
  const valueError =
    errors.value &&
    t("ketones.valueInvalid", {
      min: formatMeasured(KETONE_MIN_MMOL),
      max: formatMeasured(KETONE_MAX_MMOL),
    });

  const submit = handleSubmit((values) => {
    const body = ketoneBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      summary={errorSummaryItems(submitCount, [
        ["ketone-occurred-at", occurredAtError],
        ["ketone-value", valueError],
      ])}
      focusKey={submitCount}
      error={error}
      onSubmit={submit}
      footer={
        <DefaultFooter
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="ketone-occurred-at"
        width="medium"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={occurredAtError}
        {...register("occurredAt")}
      />
      <Field
        id="ketone-value"
        width="narrow"
        type="number"
        inputMode="decimal"
        min={KETONE_MIN_MMOL}
        max={KETONE_MAX_MMOL}
        step={0.1}
        label={t("ketones.value")}
        error={valueError}
        {...register("value")}
      />
      <SelectField
        id="ketone-method"
        width="medium"
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
    // weight:raw — значение поля ввода, а не показ: форматированную запятую
    // сервер не примет, а человек правит ровно то, что записал.
    weightKg: editing ? String(editing.weight_kg) : "",
    heightCm: editing ? numberInput(editing.height_cm) : "",
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, submitCount },
  } = useForm<WeightValues>({
    resolver: zodResolver(weightSchema),
    defaultValues: defaults(),
  });

  const occurredAtError =
    errors.occurredAt && t(occurredAtErrorKey(errors.occurredAt.message));
  const weightError =
    errors.weightKg &&
    t("weight.valueInvalid", {
      min: formatWeight(WEIGHT_MIN_KG),
      max: formatWeight(WEIGHT_MAX_KG),
    });
  const heightError = errors.heightCm && t("weight.heightInvalid");

  const submit = handleSubmit((values) => {
    const body = weightBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      summary={errorSummaryItems(submitCount, [
        ["weight-occurred-at", occurredAtError],
        ["weight-value", weightError],
        ["weight-height", heightError],
      ])}
      focusKey={submitCount}
      error={error}
      onSubmit={submit}
      footer={
        <DefaultFooter
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="weight-occurred-at"
        width="medium"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={occurredAtError}
        {...register("occurredAt")}
      />
      <Field
        id="weight-value"
        width="narrow"
        type="number"
        inputMode="decimal"
        min={WEIGHT_MIN_KG}
        max={WEIGHT_MAX_KG}
        step={0.1}
        label={t("weight.value")}
        error={weightError}
        {...register("weightKg")}
      />
      <Field
        id="weight-height"
        width="narrow"
        type="number"
        inputMode="decimal"
        min={1}
        step={0.5}
        optional
        label={t("weight.height")}
        error={heightError}
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
    formState: { errors, submitCount },
  } = useForm<MedicationValues>({
    resolver: zodResolver(medicationSchema),
    defaultValues: defaults(),
  });

  const occurredAtError =
    errors.occurredAt && t(occurredAtErrorKey(errors.occurredAt.message));
  const drugError = errors.medicationId && t("medications.drugRequired");

  const submit = handleSubmit((values) => {
    const body = medicationBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  if (medications.length === 0) {
    // Действия у пустого состояния нет намеренно: препараты назначает врач,
    // семья завести их не может.
    return (
      <EmptyState
        icon={Pill}
        title={t("medications.noneTitle")}
        description={t("medications.none")}
      />
    );
  }

  return (
    <FormShell
      summary={errorSummaryItems(submitCount, [
        ["medication-occurred-at", occurredAtError],
        ["medication-drug", drugError],
      ])}
      focusKey={submitCount}
      error={error}
      onSubmit={submit}
      footer={
        <DefaultFooter
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="medication-occurred-at"
        width="medium"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={occurredAtError}
        {...register("occurredAt")}
      />
      <SelectField
        id="medication-drug"
        width="wide"
        label={t("medications.drug")}
        error={drugError}
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
      <label className="flex min-h-touch items-center gap-section text-sm font-medium">
        <input
          type="checkbox"
          className="size-5 accent-primary"
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
    formState: { errors, submitCount },
  } = useForm<MealValues>({
    resolver: zodResolver(mealSchema),
    defaultValues: defaults(),
  });

  const occurredAtError =
    errors.occurredAt && t(occurredAtErrorKey(errors.occurredAt.message));
  const freeTextError = errors.freeText && t("meals.freeTextRequired");

  const submit = handleSubmit((values) => {
    const body = mealBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      summary={errorSummaryItems(submitCount, [
        ["meal-occurred-at", occurredAtError],
        ["meal-free-text", freeTextError],
      ])}
      focusKey={submitCount}
      error={error}
      onSubmit={submit}
      footer={
        <DefaultFooter
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="meal-occurred-at"
        width="medium"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={occurredAtError}
        {...register("occurredAt")}
      />
      <TextAreaField
        id="meal-free-text"
        rows={3}
        label={t("meals.freeText")}
        placeholder={t("meals.freeTextPlaceholder")}
        error={freeTextError}
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
    formState: { errors, submitCount },
  } = useForm<SideEffectValues>({
    resolver: zodResolver(sideEffectSchema),
    defaultValues: defaults(),
  });

  const occurredAtError =
    errors.occurredAt && t(occurredAtErrorKey(errors.occurredAt.message));
  const symptomError = errors.symptom && t("sideEffects.symptomRequired");

  const submit = handleSubmit((values) => {
    const body = sideEffectBody(values);
    if (body === null) return;
    onSubmit(body, () => reset(defaults()));
  });

  return (
    <FormShell
      summary={errorSummaryItems(submitCount, [
        ["side-effect-occurred-at", occurredAtError],
        ["side-effect-symptom", symptomError],
      ])}
      focusKey={submitCount}
      error={error}
      onSubmit={submit}
      footer={
        <DefaultFooter
          editing={editing !== null}
          pending={pending}
          onCancel={onCancel}
        />
      }
    >
      <Field
        id="side-effect-occurred-at"
        width="medium"
        type="datetime-local"
        label={t("form.occurredAt")}
        error={occurredAtError}
        {...register("occurredAt")}
      />
      <Field
        id="side-effect-symptom"
        width="wide"
        label={t("sideEffects.symptom")}
        placeholder={t("sideEffects.symptomPlaceholder")}
        error={symptomError}
        {...register("symptom")}
      />
      <TextAreaField
        id="side-effect-description"
        rows={3}
        optional
        label={t("sideEffects.description")}
        {...register("description")}
      />
    </FormShell>
  );
}
