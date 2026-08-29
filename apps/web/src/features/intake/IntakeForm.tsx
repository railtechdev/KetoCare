import {
  AsyncSection,
  FormFooter,
  Section,
  Skeleton,
  toast,
} from "@ketocare/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  optionsOfScale,
  visibleDrugs,
  useAedDrugs,
  useIntakeOptions,
  usePatientIntake,
  useSaveIntakeMutation,
  type IntakeOption,
  type IntakeScale,
  type PatientIntakeBody,
} from "./useIntake";

/** Шаги анкеты: «из окна в окно», как просил заказчик (ADR-0007). */
const STEPS = ["seizures", "therapy", "meals"] as const;
type Step = (typeof STEPS)[number];

interface Values {
  lastSeizureOn: string;
  onsetAgeId: string;
  seizureFrequencyId: string;
  seizureDurationId: string;
  mealsPerDayId: string;
  developmentalDelay: string;
  mealsRegular: string;
  currentAedIds: string[];
}

const EMPTY: Values = {
  lastSeizureOn: "",
  onsetAgeId: "",
  seizureFrequencyId: "",
  seizureDurationId: "",
  mealsPerDayId: "",
  developmentalDelay: "",
  mealsRegular: "",
  currentAedIds: [],
};

/** Пустая строка выбора — «не отвечено», а не «нет»: это разные вещи. */
function toId(value: string): string | null {
  return value === "" ? null : value;
}

function toBool(value: string): boolean | null {
  return value === "" ? null : value === "yes";
}

function fromBool(value: boolean | null | undefined): string {
  return value === null || value === undefined ? "" : value ? "yes" : "no";
}

/**
 * Анкета регистрации пациента — часть, которую заполняет семья (ADR-0007).
 *
 * Три шага вместо одного длинного списка: экран родителя решает одно дело за
 * раз (правило П26 канона), а заказчик просил ввод «из окна в окно».
 *
 * Врачебные поля — диагноз, тип приступов, число сменённых ПЭП — здесь не
 * показываются вовсе: их не просто нельзя записать (это проверяет сервер), их
 * и смотреть родителю незачем в форме, которую он заполняет о себе.
 */
export function IntakeForm({
  patientId,
  childName,
  onDone,
}: {
  patientId: string;
  childName: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("intake");

  const options = useIntakeOptions();
  const drugs = useAedDrugs();
  const intake = usePatientIntake(patientId);
  const save = useSaveIntakeMutation(patientId);

  const [step, setStep] = useState<Step>("seizures");
  const [values, setValues] = useState<Values | null>(null);

  // Ответы подставляются один раз, когда пришли: пересборка на каждый рендер
  // затирала бы то, что родитель уже набрал.
  const loaded = intake.data;
  if (values === null && !intake.isLoading) {
    setValues(
      loaded == null
        ? EMPTY
        : {
            lastSeizureOn: loaded.last_seizure_on ?? "",
            onsetAgeId: loaded.onset_age_id ?? "",
            seizureFrequencyId: loaded.seizure_frequency_id ?? "",
            seizureDurationId: loaded.seizure_duration_id ?? "",
            mealsPerDayId: loaded.meals_per_day_id ?? "",
            developmentalDelay: fromBool(loaded.developmental_delay),
            mealsRegular: fromBool(loaded.meals_regular),
            currentAedIds: loaded.current_aed_ids ?? [],
          },
    );
  }

  const stepIndex = STEPS.indexOf(step);
  const isLast = stepIndex === STEPS.length - 1;

  function patch(change: Partial<Values>) {
    setValues((current) => ({ ...(current ?? EMPTY), ...change }));
  }

  function submit() {
    const current = values ?? EMPTY;
    const body: PatientIntakeBody = {
      last_seizure_on:
        current.lastSeizureOn === "" ? null : current.lastSeizureOn,
      onset_age_id: toId(current.onsetAgeId),
      seizure_frequency_id: toId(current.seizureFrequencyId),
      seizure_duration_id: toId(current.seizureDurationId),
      meals_per_day_id: toId(current.mealsPerDayId),
      developmental_delay: toBool(current.developmentalDelay),
      meals_regular: toBool(current.mealsRegular),
      current_aed_ids: current.currentAedIds,
    };

    save.mutate(body, {
      onSuccess: () => {
        toast.success(t("saved", { name: childName }));
        onDone();
      },
    });
  }

  return (
    <AsyncSection
      loading={intake.isLoading || options.isLoading}
      skeleton={
        <div className="flex flex-col gap-block" role="status" aria-busy="true">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      }
      error={
        options.isError
          ? {
              title: t("errors.options"),
              description:
                errorMessageOf(options.error) ?? t("common:errors.unexpected"),
            }
          : null
      }
      retryLabel={t("common:actions.retry")}
      onRetry={() => void options.refetch()}
      isEmpty={values === null}
      empty={null}
    >
      {values !== null && (
        <form
          className="flex flex-col gap-block"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (isLast) submit();
            else setStep(STEPS[stepIndex + 1]!);
          }}
        >
          <p className="m-0 text-sm text-muted-foreground">
            {t("step", { current: stepIndex + 1, total: STEPS.length })}
            {" · "}
            {t("optionalHint")}
          </p>

          {step === "seizures" && (
            <Section title={t("sections.seizures")}>
              <ScaleField
                scale="onset_age"
                label={t("fields.onsetAge")}
                options={options.data ?? []}
                value={values.onsetAgeId}
                onChange={(value) => patch({ onsetAgeId: value })}
              />
              <Field
                id="intake-last-seizure"
                type="date"
                width="date"
                label={t("fields.lastSeizureOn")}
                hint={t("fields.lastSeizureHint")}
                value={values.lastSeizureOn}
                onChange={(event) =>
                  patch({ lastSeizureOn: event.target.value })
                }
              />
              <ScaleField
                scale="seizure_frequency"
                label={t("fields.frequency")}
                options={options.data ?? []}
                value={values.seizureFrequencyId}
                onChange={(value) => patch({ seizureFrequencyId: value })}
              />
              <ScaleField
                scale="seizure_duration"
                label={t("fields.duration")}
                options={options.data ?? []}
                value={values.seizureDurationId}
                onChange={(value) => patch({ seizureDurationId: value })}
              />
            </Section>
          )}

          {step === "therapy" && (
            <Section title={t("sections.therapy")}>
              <SelectField
                id="intake-delay"
                width="medium"
                label={t("fields.developmentalDelay")}
                value={values.developmentalDelay}
                onChange={(event) =>
                  patch({ developmentalDelay: event.target.value })
                }
              >
                <option value="">{t("notAnswered")}</option>
                <option value="yes">{t("yes")}</option>
                <option value="no">{t("no")}</option>
              </SelectField>

              <DrugPicker
                label={t("fields.currentAed")}
                hint={t("fields.currentAedHint")}
                drugs={visibleDrugs(drugs.data ?? [], values.currentAedIds)}
                loading={drugs.isLoading}
                selected={values.currentAedIds}
                onToggle={(id, checked) =>
                  patch({
                    currentAedIds: checked
                      ? [...values.currentAedIds, id]
                      : values.currentAedIds.filter((value) => value !== id),
                  })
                }
              />

              <p className="m-0 text-sm text-muted-foreground">
                {t("doctorFieldsHint")}
              </p>
            </Section>
          )}

          {step === "meals" && (
            <Section title={t("sections.meals")}>
              <SelectField
                id="intake-meals-regular"
                width="medium"
                label={t("fields.mealsRegular")}
                value={values.mealsRegular}
                onChange={(event) =>
                  patch({ mealsRegular: event.target.value })
                }
              >
                <option value="">{t("notAnswered")}</option>
                <option value="yes">{t("yes")}</option>
                <option value="no">{t("no")}</option>
              </SelectField>

              <ScaleField
                scale="meals_per_day"
                label={t("fields.mealsPerDay")}
                hint={t("fields.mealsPerDayHint")}
                options={options.data ?? []}
                value={values.mealsPerDayId}
                onChange={(value) => patch({ mealsPerDayId: value })}
              />
            </Section>
          )}

          {save.isError && (
            <FormError>
              {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
            </FormError>
          )}

          <FormFooter
            submitLabel={isLast ? t("submit") : t("next")}
            pendingLabel={t("saving")}
            pending={save.isPending}
            cancelLabel={
              stepIndex === 0 ? t("common:actions.cancel") : t("back")
            }
            onCancel={
              stepIndex === 0 ? onDone : () => setStep(STEPS[stepIndex - 1]!)
            }
          />
        </form>
      )}
    </AsyncSection>
  );
}

function ScaleField({
  scale,
  label,
  hint,
  options,
  value,
  onChange,
}: {
  scale: IntakeScale;
  label: string;
  hint?: string;
  options: readonly IntakeOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("intake");
  const items = useMemo(
    () => optionsOfScale(options, scale, value),
    [options, scale, value],
  );

  return (
    <SelectField
      id={`intake-${scale}`}
      width="wide"
      label={label}
      hint={hint}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t("notAnswered")}</option>
      {items.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name_ru}
        </option>
      ))}
    </SelectField>
  );
}

/**
 * Множественный выбор препаратов.
 *
 * Флажками, а не списком с Ctrl: родитель отмечает то, что стоит у него на
 * полке, и множественный выбор мышью с клавишей — не тот жест, которому здесь
 * место. Названия — как в анкете заказчика: родитель узнаёт препарат по
 * упаковке, а не по действующему веществу.
 */
function DrugPicker({
  label,
  hint,
  drugs,
  loading,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  drugs: readonly { id: string; name_ru: string }[];
  loading: boolean;
  selected: readonly string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-field text-card-title font-semibold">
        {label}
      </legend>
      <p className="mt-0 mb-field text-sm text-muted-foreground">{hint}</p>

      <ul className="m-0 grid list-none grid-cols-1 gap-field p-0 sm:grid-cols-2">
        {drugs.map((drug) => (
          <li key={drug.id}>
            <label className="flex min-h-touch items-center gap-field text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                checked={selected.includes(drug.id)}
                onChange={(event) => onToggle(drug.id, event.target.checked)}
              />
              <span className="min-w-0">{drug.name_ru}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
