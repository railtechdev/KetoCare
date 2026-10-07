import {
  Button,
  FieldShell,
  FormSheet,
  Input,
  KETONE_MAX_MMOL,
  KETONE_MIN_MMOL,
  NativeSelect,
  OCCURRED_AT_FUTURE,
  SEIZURE_COUNT_MIN,
  Textarea,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  diaryFieldErrors,
  formatMeasured,
  formatWeight,
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
  toast,
  weightBody,
  weightSchema,
  type DiaryEntryBody,
} from "@ketocare/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useTelegramBack, useUnsavedGuard } from "../../lib/useTelegram";
import type { DiaryLog, MedicationOption, NamedOption } from "./useDiary";

type Values = Record<string, string | boolean>;
type Errors = Record<string, string>;

interface Rules {
  schema: Parameters<typeof diaryFieldErrors>[0];
  /** Тело запроса из уже проверенных значений. */
  body: (values: Values) => DiaryEntryBody | null;
}

/*
 * Схема и сборка тела — из кита, те же, что у кабинета (ADR-0044). Приведение
 * `as never` безопасно: тело собирается только после того, как схема того же
 * вида приняла значения, то есть форма значений уже совпала с ожидаемой.
 */
const RULES: Record<DiaryLog["kind"], Rules> = {
  seizures: { schema: seizureSchema, body: (v) => seizureBody(v as never) },
  ketones: { schema: ketoneSchema, body: (v) => ketoneBody(v as never) },
  weight: { schema: weightSchema, body: (v) => weightBody(v as never) },
  medications: {
    schema: medicationSchema,
    body: (v) => medicationBody(v as never),
  },
  meals: { schema: mealSchema, body: (v) => mealBody(v as never) },
  "side-effects": {
    schema: sideEffectSchema,
    body: (v) => sideEffectBody(v as never),
  },
};

/** Поля первого шага приступа — те же, что у кабинета. */
const SEIZURE_FIRST_STEP = [
  "occurredAt",
  "seizureTypeId",
  "durationSec",
  "durationOptionId",
];

/** Значения формы из записи: правят ровно то, что записали. */
function valuesOf(entry: DiaryLog): Values {
  const occurredAt = toDateTimeLocalInput(new Date(entry.occurred_at));
  switch (entry.kind) {
    case "seizures":
      return {
        occurredAt,
        seizureTypeId: entry.seizure_type_id,
        durationSec:
          entry.duration_sec === null ? "" : String(entry.duration_sec),
        durationOptionId: entry.duration_option_id ?? "",
        count: String(entry.count),
        description: entry.description ?? "",
        triggers: entry.triggers ?? "",
      };
    case "ketones":
      return { occurredAt, value: String(entry.value), method: entry.method };
    case "weight":
      return {
        occurredAt,
        // weight:raw — значение поля ввода: сервер не примет запятую.
        weightKg: String(entry.weight_kg),
        heightCm: entry.height_cm === null ? "" : String(entry.height_cm),
      };
    case "medications":
      return {
        occurredAt,
        medicationId: entry.medication_id,
        taken: entry.taken,
      };
    case "meals":
      return { occurredAt, freeText: entry.free_text ?? "" };
    case "side-effects":
      return {
        occurredAt,
        symptom: entry.symptom,
        description: entry.description ?? "",
      };
  }
}

export interface EntryEditSheetProps {
  entry: DiaryLog;
  title: string;
  seizureTypes: NamedOption[];
  durationOptions: NamedOption[];
  medications: MedicationOption[];
  pending: boolean;
  /** Отказ последнего сохранения — его словами сервера (раздел 5.1). */
  error: unknown;
  onSave: (body: DiaryEntryBody, onSaved: () => void) => void;
  onClose: () => void;
}

/**
 * Правка записи дневника панелью снизу — поля того же вида, что в кабинете.
 *
 * Своей библиотеки форм здесь нет: полей не больше четырёх, а проверку и
 * сборку тела делает кит. Ошибка сервера показывается его словами (раздел 5.1).
 */
export function EntryEditSheet({
  entry,
  title,
  seizureTypes,
  durationOptions,
  medications,
  pending,
  error,
  onSave,
  onClose,
}: EntryEditSheetProps) {
  const { t } = useTranslation();
  const initial = useMemo(() => valuesOf(entry), [entry]);
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(1);
  const rules = RULES[entry.kind];

  const set = (name: string) => (value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));

  // Незаконченная правка: Telegram спросит «закрыть?», а жест вниз по форме
  // не свернёт приложение вместе с ней.
  const dirty = Object.keys(values).some(
    (name) => values[name] !== initial[name],
  );
  useUnsavedGuard(dirty);

  // «Назад» Telegram — шаг назад в форме, а с первого шага — закрыть её.
  // Без этого аппаратная «Назад» на Android закрывала весь Mini App.
  const back = () => {
    if (step === 2) setStep(1);
    else onClose();
  };
  useTelegramBack(pending ? null : back);

  function submit() {
    const found = diaryFieldErrors(rules.schema, values);
    if (entry.kind === "seizures" && step === 1) {
      // Второй шаг открывается только с годным первым: иначе ошибка всплыла
      // бы при сохранении на экране, где этого поля не видно.
      const firstStep = Object.fromEntries(
        Object.entries(found).filter(([name]) =>
          SEIZURE_FIRST_STEP.includes(name),
        ),
      );
      setErrors(firstStep);
      if (Object.keys(firstStep).length === 0) setStep(2);
      return;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = rules.body(values);
    if (body === null) return;
    onSave(body, () => {
      toast.success(t("diary.saved"));
      onClose();
    });
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("diary.editTitle")}
      description={title}
      closeLabel={t("diary.close")}
    >
      <form
        noValidate
        className="flex flex-col gap-section"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <EntryFields
          entry={entry}
          step={step}
          values={values}
          errors={errors}
          set={set}
          seizureTypes={seizureTypes}
          durationOptions={durationOptions}
          medications={medications}
        />

        {error != null && (
          <p role="alert" className="m-0 text-destructive">
            {errorMessageOf(error) ?? t("diary.saveFailed")}
          </p>
        )}

        <div className="flex flex-wrap gap-field">
          <Button type="submit" className="min-h-touch" disabled={pending}>
            {entry.kind === "seizures" && step === 1
              ? t("diary.next")
              : pending
                ? t("diary.saving")
                : t("diary.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            disabled={pending}
            onClick={back}
          >
            {step === 2 ? t("diary.back") : t("actions.cancel")}
          </Button>
        </div>
      </form>
    </FormSheet>
  );
}

function EntryFields({
  entry,
  step,
  values,
  errors,
  set,
  seizureTypes,
  durationOptions,
  medications,
}: {
  entry: DiaryLog;
  step: number;
  values: Values;
  errors: Errors;
  set: (name: string) => (value: string | boolean) => void;
  seizureTypes: NamedOption[];
  durationOptions: NamedOption[];
  medications: MedicationOption[];
}) {
  const { t } = useTranslation();
  const text = (name: string) => String(values[name] ?? "");

  const occurredAt = (
    <TextField
      label={t("diary.form.occurredAt")}
      type="datetime-local"
      value={text("occurredAt")}
      onChange={set("occurredAt")}
      error={
        errors.occurredAt === undefined
          ? undefined
          : errors.occurredAt === OCCURRED_AT_FUTURE
            ? t("diary.form.occurredAtFuture")
            : t("diary.form.occurredAtInvalid")
      }
    />
  );

  switch (entry.kind) {
    case "seizures":
      return step === 1 ? (
        <>
          {occurredAt}
          {/* Без справочника тип не меняется: он уезжает на сервер прежним,
              придумать идентификатор нельзя. */}
          {seizureTypes.length > 0 && (
            <SelectField
              label={t("diary.form.seizureType")}
              value={text("seizureTypeId")}
              onChange={set("seizureTypeId")}
              // Выведенный тип остаётся в списке только у записи, которая на
              // нём стоит: новый приступ — по ILAE 2025 (ADR-0050).
              options={withCurrent(
                seizureTypes.filter(
                  (type) => !type.retired || type.id === text("seizureTypeId"),
                ),
                text("seizureTypeId"),
                t,
              )}
            />
          )}
          <DurationField
            values={values}
            errors={errors}
            set={set}
            durationOptions={durationOptions}
          />
        </>
      ) : (
        <>
          <TextField
            label={t("diary.form.count")}
            type="number"
            inputMode="numeric"
            min={SEIZURE_COUNT_MIN}
            value={text("count")}
            onChange={set("count")}
            error={errors.count && t("diary.form.countInvalid")}
          />
          <AreaField
            label={t("diary.form.description")}
            optional
            value={text("description")}
            onChange={set("description")}
          />
          <AreaField
            label={t("diary.form.triggers")}
            optional
            value={text("triggers")}
            onChange={set("triggers")}
          />
        </>
      );
    case "ketones":
      return (
        <>
          {occurredAt}
          <TextField
            label={t("diary.form.ketoneValue")}
            type="number"
            inputMode="decimal"
            step="0.1"
            value={text("value")}
            onChange={set("value")}
            error={
              errors.value &&
              t("diary.form.ketoneInvalid", {
                min: formatMeasured(KETONE_MIN_MMOL),
                max: formatMeasured(KETONE_MAX_MMOL),
              })
            }
          />
          <SelectField
            label={t("diary.form.method")}
            value={text("method")}
            onChange={set("method")}
            options={[
              { id: "blood", name: t("diary.form.methodBlood") },
              { id: "urine", name: t("diary.form.methodUrine") },
            ]}
          />
        </>
      );
    case "weight":
      return (
        <>
          {occurredAt}
          <TextField
            label={t("diary.form.weightValue")}
            type="number"
            inputMode="decimal"
            step="0.1"
            value={text("weightKg")}
            onChange={set("weightKg")}
            error={
              errors.weightKg &&
              t("diary.form.weightInvalid", {
                min: formatWeight(WEIGHT_MIN_KG),
                max: formatWeight(WEIGHT_MAX_KG),
              })
            }
          />
          <TextField
            label={t("diary.form.height")}
            optional
            type="number"
            inputMode="decimal"
            value={text("heightCm")}
            onChange={set("heightCm")}
            error={errors.heightCm && t("diary.form.heightInvalid")}
          />
        </>
      );
    case "medications":
      return (
        <>
          {occurredAt}
          <SelectField
            label={t("diary.form.medication")}
            value={text("medicationId")}
            onChange={set("medicationId")}
            options={withCurrent(medications, text("medicationId"), t)}
            error={errors.medicationId && t("diary.form.medicationRequired")}
          />
          <label className="flex min-h-touch items-center gap-field">
            <input
              type="checkbox"
              className="size-6 accent-primary"
              checked={values.taken === true}
              onChange={(event) => set("taken")(event.target.checked)}
            />
            <span>{t("diary.form.taken")}</span>
          </label>
        </>
      );
    case "meals":
      return (
        <>
          {occurredAt}
          <AreaField
            label={t("diary.form.mealText")}
            value={text("freeText")}
            onChange={set("freeText")}
            error={errors.freeText && t("diary.form.mealRequired")}
          />
        </>
      );
    case "side-effects":
      return (
        <>
          {occurredAt}
          <TextField
            label={t("diary.form.symptom")}
            value={text("symptom")}
            onChange={set("symptom")}
            error={errors.symptom && t("diary.form.symptomRequired")}
          />
          <AreaField
            label={t("diary.form.sideDescription")}
            optional
            value={text("description")}
            onChange={set("description")}
          />
        </>
      );
  }
}

/**
 * Длительность приступа — выбор «засекали / со слов», а под ним одно поле.
 *
 * Прежде на шаге стояли оба поля сразу (секунды и интервал) плюс подсказка
 * «одно из двух, не оба» — четыре поля на экране и ошибка, которую форма сама
 * провоцировала. Это разные величины (ADR-0020): измеренное и названное со
 * слов, — и выбор между ними делается словами, а не тем, какое поле заполнить.
 * Переключение очищает второе поле: оба сразу сервер не примет.
 */
function DurationField({
  values,
  errors,
  set,
  durationOptions,
}: {
  values: Values;
  errors: Errors;
  set: (name: string) => (value: string | boolean) => void;
  durationOptions: NamedOption[];
}) {
  const { t } = useTranslation();
  const text = (name: string) => String(values[name] ?? "");
  const [mode, setMode] = useState<"measured" | "estimated">(() =>
    text("durationSec") !== "" ? "measured" : "estimated",
  );

  const choose = (next: "measured" | "estimated") => {
    setMode(next);
    if (next === "measured") set("durationOptionId")("");
    else set("durationSec")("");
  };

  return (
    <fieldset className="m-0 flex flex-col gap-field border-0 p-0">
      <legend className="mb-1 p-0">{t("diary.form.durationMode")}</legend>
      <div className="flex flex-wrap gap-x-section">
        {(["estimated", "measured"] as const).map((option) => (
          <label
            key={option}
            className="flex min-h-touch cursor-pointer items-center gap-field"
          >
            <input
              type="radio"
              name="duration-mode"
              className="size-5 accent-primary"
              checked={mode === option}
              onChange={() => choose(option)}
            />
            {t(
              option === "measured"
                ? "diary.form.durationMeasured"
                : "diary.form.durationEstimated",
            )}
          </label>
        ))}
      </div>
      {mode === "measured" ? (
        <TextField
          label={t("diary.form.durationSec")}
          optional
          type="number"
          inputMode="numeric"
          value={text("durationSec")}
          onChange={set("durationSec")}
          hint={t("diary.form.durationHint")}
          error={errors.durationSec && t("diary.form.durationSecInvalid")}
        />
      ) : (
        <SelectField
          label={t("diary.form.durationChoice")}
          optional
          value={text("durationOptionId")}
          onChange={set("durationOptionId")}
          options={[
            { id: "", name: t("diary.form.durationChoiceNone") },
            ...durationOptions,
          ]}
          error={errors.durationOptionId && t("diary.form.durationBoth")}
        />
      )}
    </fieldset>
  );
}

/**
 * Список вариантов с уже записанным значением, даже если справочник его не
 * знает: иначе селект молча подставил бы первый вариант, и сохранение
 * переписало бы лекарство или тип приступа, которого человек не трогал.
 */
function withCurrent(
  options: NamedOption[],
  current: string,
  t: (key: string) => string,
): NamedOption[] {
  if (current === "" || options.some((option) => option.id === current)) {
    return options;
  }
  return [{ id: current, name: t("diary.form.unknownOption") }, ...options];
}

function TextField({
  label,
  optional,
  hint,
  error,
  value,
  onChange,
  type = "text",
  inputMode,
  step,
  min,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string | false;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "decimal" | "numeric";
  step?: string;
  min?: number;
}) {
  const { t } = useTranslation();
  return (
    <FieldShell
      label={label}
      optionalLabel={optional ? t("diary.optional") : undefined}
      hint={hint}
      error={error}
    >
      {({ describedBy, invalid }) => (
        <Input
          type={type}
          inputMode={inputMode}
          step={step}
          min={min}
          className="min-h-touch"
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

function AreaField({
  label,
  optional,
  error,
  value,
  onChange,
}: {
  label: string;
  optional?: boolean;
  error?: string | false;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <FieldShell
      label={label}
      optionalLabel={optional ? t("diary.optional") : undefined}
      error={error}
    >
      {({ describedBy, invalid }) => (
        <Textarea
          rows={3}
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

function SelectField({
  label,
  optional,
  error,
  value,
  onChange,
  options,
}: {
  label: string;
  optional?: boolean;
  error?: string | false;
  value: string;
  onChange: (value: string) => void;
  options: NamedOption[];
}) {
  const { t } = useTranslation();
  return (
    <FieldShell
      label={label}
      optionalLabel={optional ? t("diary.optional") : undefined}
      error={error}
    >
      {({ describedBy, invalid }) => (
        <NativeSelect
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </FieldShell>
  );
}
