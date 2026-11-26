import {
  Button,
  FieldShell,
  FormSheet,
  Input,
  KETONE_MAX_MMOL,
  KETONE_MIN_MMOL,
  NativeSelect,
  SegmentedControl,
  cn,
  OCCURRED_AT_FUTURE,
  SEIZURE_COUNT_MIN,
  StatusNote,
  Textarea,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  diaryFieldErrors,
  formatMeasured,
  formatOccurredAt,
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
  useAttemptKey,
  weightBody,
  weightSchema,
  type DiaryEntryBody,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { RemoveButton } from "../../components/RemoveButton";
import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";
import { errorMessageOf } from "../../lib/api";
import { useOnline } from "../../lib/connectivity";
import {
  useBottomButtons,
  useTelegramBack,
  useUnsavedGuard,
} from "../../lib/useTelegram";
import {
  SeizureTypePicker,
  type SeizurePickerLevel,
} from "./SeizureTypePicker";
import {
  DICTIONARY_READY,
  type CreatableKind,
  type DiaryLog,
  type DictionaryStatus,
  type MedicationOption,
  type NamedOption,
} from "./useDiary";

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

/**
 * Значения новой записи.
 *
 * Время — «сейчас»: чаще всего записывают только что случившееся, а поправить
 * время проще, чем набрать. Лекарство и тип приступа не подставляются: выбор
 * по умолчанию записал бы препарат или приступ, которого человек не выбирал.
 * Лекарство по умолчанию «дали» — как в боте, где отметка о приёме и есть
 * запись; «пропустили» выбирается явно.
 */
function defaultsOf(
  kind: CreatableKind,
  ketoneMethod: "blood" | "urine" | null,
): Values {
  const occurredAt = toDateTimeLocalInput(new Date());
  switch (kind) {
    case "seizures":
      return {
        occurredAt,
        seizureTypeId: "",
        durationSec: "",
        durationOptionId: "",
        count: String(SEIZURE_COUNT_MIN),
        description: "",
        triggers: "",
      };
    case "ketones":
      // Способ — последнего замера ребёнка, как в боте. Всегда «по крови»
      // семья с полосками для мочи записывала бы кровь (аудит 26.11.2026,
      // 2.9). Замеров не было — ничего не подставляется: выбор за человеком.
      return { occurredAt, value: "", method: ketoneMethod ?? "" };
    case "weight":
      return { occurredAt, weightKg: "", heightCm: "" };
    case "medications":
      return { occurredAt, medicationId: "", taken: true };
    case "side-effects":
      return { occurredAt, symptom: "", description: "" };
  }
}

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
  /**
   * Что открыто: правка записи или новая запись этого вида.
   *
   * Форма одна на оба случая — поля, проверка и тело запроса не должны
   * расходиться между «записать» и «исправить» (дополнение к ADR-0044 от
   * 07.10.2026).
   */
  target: { entry: DiaryLog } | { kind: CreatableKind };
  /** Подзаголовок панели: какая запись правится или какого вида новая. */
  title: string;
  seizureTypes: NamedOption[];
  /**
   * Загрузка справочника типов: пустой список выше — это и «ещё идёт», и
   * «ждёт связи», и «сервер отказал», а сказать выбор обязан разное.
   */
  seizureTypesStatus?: DictionaryStatus;
  /**
   * Типы прошлых приступов ребёнка — первый экран выбора типа (Д3). Пусто —
   * выбор начинается с групп классификации; `null` — ответ ещё идёт, и
   * первый экран ждёт его, а не рисуется дважды.
   */
  recentSeizureTypes?: readonly string[] | null;
  durationOptions: NamedOption[];
  medications: MedicationOption[];
  pending: boolean;
  /** Отказ последнего сохранения — его словами сервера (раздел 5.1). */
  error: unknown;
  /**
   * `attemptKey` — ключ попытки для `Idempotency-Key` (ADR-0035): тот же,
   * пока не изменилось введённое, поэтому повтор после потерянного ответа не
   * заводит вторую запись.
   */
  onSave: (
    body: DiaryEntryBody,
    onSaved: () => void,
    attemptKey: string,
  ) => void;
  /** Закрыть форму совсем: сохранено или панель смахнули. */
  onClose: () => void;
  /**
   * «Назад» с первого шага и «Отмена». У новой записи это возврат к выбору
   * вида, у правки — то же, что закрыть.
   */
  onBack?: () => void;
  /**
   * Удалить запись — только у правки своей записи. Удаление живёт здесь, а не
   * кнопкой в ленте: в строке ленты оно стояло рядом с «Исправить» и съедало
   * ширину значения (аудит Mini App 21.11.2026, Д2).
   */
  onDelete?: () => void;
  /** Удаление уже отправлено — кнопка ждёт ответа. */
  deleting?: boolean;
  /** Способ последнего замера кетонов ребёнка — умолчание новой записи. */
  lastKetoneMethod?: "blood" | "urine" | null;
}

/**
 * Правка записи дневника панелью снизу — поля того же вида, что в кабинете.
 *
 * Своей библиотеки форм здесь нет: полей не больше четырёх, а проверку и
 * сборку тела делает кит. Ошибка сервера показывается его словами (раздел 5.1).
 */
export function EntryEditSheet({
  target,
  title,
  seizureTypes,
  seizureTypesStatus = DICTIONARY_READY,
  recentSeizureTypes = [],
  durationOptions,
  medications,
  pending,
  error,
  onSave,
  onClose,
  onBack = onClose,
  onDelete,
  deleting = false,
  lastKetoneMethod = null,
}: EntryEditSheetProps) {
  const { t } = useTranslation();
  const creating = "kind" in target;
  const kind = "kind" in target ? target.kind : target.entry.kind;
  // Начальные значения — на всё время жизни формы: «сейчас» у новой записи
  // не должно уезжать с каждой отрисовкой, иначе форма сочла бы себя
  // изменённой, ничего не получив от человека.
  const [initial] = useState<Values>(() =>
    "kind" in target
      ? defaultsOf(target.kind, lastKetoneMethod)
      : valuesOf(target.entry),
  );
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(1);
  // Выбор типа приступа — стопка уровней (Д3). У нового приступа он открыт
  // сразу: тип — первый вопрос, как в боте; у правки — по «Изменить тип».
  const [picker, setPicker] = useState<SeizurePickerLevel[] | null>(() =>
    creating && kind === "seizures" ? [{ at: "first" }] : null,
  );
  const level = picker?.at(-1) ?? null;
  // Выведенные типы новой записью не выбираются (ADR-0050).
  const activeSeizureTypes = seizureTypes.filter((type) => !type.retired);
  const rules = RULES[kind];
  const online = useOnline();
  const attemptKey = useAttemptKey(`${kind}:${JSON.stringify(values)}`);
  // Шаг, на котором запись уходит на сервер: «Далее» у приступа сети не
  // требует, «Сохранить» без неё отказал бы — об этом говорится заранее.
  const savingStep = !(kind === "seizures" && step === 1);
  const blockedOffline = savingStep && !online;

  const set = (name: string) => (value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));
  const text = (name: string) => String(values[name] ?? "");

  // Незаконченная правка: Telegram спросит «закрыть?», а жест вниз по форме
  // не свернёт приложение вместе с ней.
  const dirty = Object.keys(values).some(
    (name) => values[name] !== initial[name],
  );
  useUnsavedGuard(dirty);

  // «Назад» Telegram — шаг назад в форме, а с первого шага — закрыть её.
  // Без этого аппаратная «Назад» на Android закрывала весь Mini App.
  const back = () => {
    if (picker !== null) {
      // Уровень выше; с первого уровня — к форме, а у нового приступа без
      // выбранного типа — туда, откуда форму открыли: формы без типа нет.
      if (picker.length > 1) setPicker(picker.slice(0, -1));
      else if (creating && text("seizureTypeId") === "") onBack();
      else setPicker(null);
      return;
    }
    if (step === 2) setStep(1);
    else onBack();
  };
  const pickType = (typeId: string) => {
    set("seizureTypeId")(typeId);
    setErrors((current) => {
      const next = { ...current };
      delete next.seizureTypeId;
      return next;
    });
    setPicker(null);
  };
  useTelegramBack(pending ? null : back);

  const primaryLabel = !savingStep
    ? t("diary.next")
    : pending
      ? t("diary.saving")
      : t("diary.save");
  const secondaryLabel = step === 2 ? t("diary.back") : t("actions.cancel");
  // «Сохранить» и «Отмена» — родными кнопками Telegram внизу экрана (Bot API
  // 7.10): над клавиатурой, на привычном месте. Вне Telegram и в старом
  // клиенте — кнопками формы.
  // Пока открыт выбор типа, сохранять нечего: вариант выбирается нажатием,
  // а «Назад» — кнопка Telegram.
  const native = useBottomButtons(
    picker !== null
      ? null
      : {
          main: {
            text: primaryLabel,
            onClick: () => submit(),
            disabled: blockedOffline,
            progress: pending,
          },
          secondary: { text: secondaryLabel, onClick: back, disabled: pending },
        },
  );

  function submit() {
    const found = diaryFieldErrors(rules.schema, values);
    if (kind === "seizures" && step === 1) {
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
    // Выключенная кнопка — не единственная защита: Enter в поле отправляет
    // форму в обход неё.
    if (blockedOffline || pending) return;
    const body = rules.body(values);
    if (body === null) return;
    onSave(
      body,
      () => {
        toast.success(
          t(creating ? "diary.added" : "diary.saved"),
          // Приступ и самочувствие — самые тревожные записи, и не сказано
          // было, кто и когда их увидит (аудит 26.11.2026, 3.8).
          creating && (kind === "seizures" || kind === "side-effects")
            ? { description: t("diary.addedWhoSees"), duration: 10_000 }
            : undefined,
        );
        onClose();
      },
      attemptKey,
    );
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(creating ? "diary.add.formTitle" : "diary.editTitle")}
      description={title}
      closeLabel={t("diary.close")}
      // Панель выезжает поверх страницы, вне её отступов: шапка Telegram в
      // полноэкранном режиме и домашняя полоса закрывали бы её края.
      className="pt-(--safe-top,0px) pb-(--safe-bottom,0px)"
    >
      {level !== null ? (
        <div className="flex flex-col gap-section">
          <SeizureTypePicker
            level={level}
            types={activeSeizureTypes}
            dictionary={seizureTypesStatus}
            recent={recentSeizureTypes}
            onPick={pickType}
            onOpen={(next) => setPicker([...(picker ?? []), next])}
          />
          {!native && (
            <Button
              type="button"
              variant="outline"
              className="min-h-touch w-full"
              onClick={back}
            >
              {t("diary.back")}
            </Button>
          )}
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-section"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <EntryFields
            kind={kind}
            creating={creating}
            step={step}
            values={values}
            errors={errors}
            set={set}
            seizureTypes={seizureTypes}
            canChangeType={activeSeizureTypes.length > 0}
            onChangeType={() => setPicker([{ at: "first" }])}
            durationOptions={durationOptions}
            medications={medications}
          />

          {blockedOffline && <StatusNote>{t("errors.network")}</StatusNote>}

          {error != null && (
            <p role="alert" className="m-0 text-destructive">
              {errorMessageOf(error) ?? t("diary.saveFailed")}
            </p>
          )}

          {!native && (
            <div className="flex flex-col gap-field">
              <Button
                type="submit"
                className="min-h-touch w-full"
                disabled={pending || blockedOffline}
                aria-busy={pending || undefined}
              >
                {primaryLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-touch w-full"
                disabled={pending}
                onClick={back}
              >
                {secondaryLabel}
              </Button>
            </div>
          )}

          {onDelete !== undefined && (
            // Вторичное и опасное — последним, под сохранением, и только с
            // подтверждением: вернуть удалённую запись семья сама не может.
            <TelegramConfirmDialog
              trigger={
                <RemoveButton
                  label={
                    deleting ? t("diary.deleting") : t("diary.deleteEntry")
                  }
                  disabled={deleting || pending}
                  aria-label={t("diary.deleteAria", { title })}
                  className="self-center"
                />
              }
              title={t("diary.confirmTitle", { title })}
              description={t("diary.confirmBody", {
                when:
                  "entry" in target
                    ? formatOccurredAt(new Date(target.entry.occurred_at))
                    : "",
              })}
              confirmLabel={t("diary.confirmYes")}
              cancelLabel={t("actions.cancel")}
              onConfirm={onDelete}
            />
          )}
        </form>
      )}
    </FormSheet>
  );
}

function EntryFields({
  kind,
  creating,
  step,
  values,
  errors,
  set,
  seizureTypes,
  canChangeType,
  onChangeType,
  durationOptions,
  medications,
}: {
  kind: DiaryLog["kind"];
  creating: boolean;
  step: number;
  values: Values;
  errors: Errors;
  set: (name: string) => (value: string | boolean) => void;
  seizureTypes: NamedOption[];
  /** Есть из чего выбрать: без справочника тип не меняется. */
  canChangeType: boolean;
  onChangeType: () => void;
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

  // У новой записи выбора ещё нет: первым стоит «Выберите», а не первый
  // вариант, иначе запись ушла бы с тем, что человек не выбирал.
  const choose = creating ? [{ id: "", name: t("diary.form.choose") }] : [];

  switch (kind) {
    case "seizures":
      return step === 1 ? (
        <>
          {occurredAt}
          {/* Тип выбран на своём экране (Д3); здесь он назван, и его можно
              сменить. Без справочника тип не меняется: он уезжает на сервер
              прежним, придумать идентификатор нельзя. Выведенный тип
              записи называется по-прежнему (ADR-0050). */}
          <SeizureTypeRow
            name={seizureTypeName(seizureTypes, text("seizureTypeId"), t)}
            canChange={canChangeType}
            onChange={onChangeType}
            error={errors.seizureTypeId && t("diary.form.seizureTypeRequired")}
          />
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
            autoFocus
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
              ...(text("method") === "" ? choose : []),
              { id: "blood", name: t("diary.form.methodBlood") },
              { id: "urine", name: t("diary.form.methodUrine") },
            ]}
            error={errors.method && t("diary.form.methodRequired")}
          />
        </>
      );
    case "weight":
      return (
        <>
          {occurredAt}
          <TextField
            label={t("diary.form.weightValue")}
            autoFocus
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
            autoFocus
            value={text("medicationId")}
            onChange={set("medicationId")}
            options={[
              ...choose,
              ...withCurrent(
                medicationChoices(medications, text("occurredAt")),
                text("medicationId"),
                t,
              ),
            ]}
            error={errors.medicationId && t("diary.form.medicationRequired")}
          />
          {/* Два слова, а не флажок «дали»: снятый флажок незаметен, и
              пропуск приёма читался бы как забытая галочка. */}
          <div className="flex flex-col gap-1">
            <span>{t("diary.form.takenQuestion")}</span>
            <SegmentedControl
              label={t("diary.form.takenQuestion")}
              value={values.taken === false ? "no" : "yes"}
              onChange={(value) => set("taken")(value === "yes")}
              items={[
                { value: "yes", label: t("diary.entry.taken") },
                { value: "no", label: t("diary.entry.notTaken") },
              ]}
              className="w-full [&>label]:flex-1"
            />
          </div>
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
            autoFocus
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
    <div className="flex flex-col gap-field">
      <span>{t("diary.form.durationMode")}</span>
      <SegmentedControl
        label={t("diary.form.durationMode")}
        value={mode}
        onChange={choose}
        items={[
          { value: "estimated", label: t("diary.form.durationEstimated") },
          { value: "measured", label: t("diary.form.durationMeasured") },
        ]}
        className="w-full [&>label]:flex-1 [&>label]:whitespace-normal"
      />
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
    </div>
  );
}

/** Название записанного типа — или честное «как записано раньше». */
function seizureTypeName(
  types: NamedOption[],
  current: string,
  t: (key: string) => string,
): string | null {
  if (current === "") return null;
  return (
    types.find((type) => type.id === current)?.name ??
    t("diary.form.unknownOption")
  );
}

/** «Какой приступ: …» и «Изменить тип» — вместо списка из 25 терминов. */
function SeizureTypeRow({
  name,
  canChange,
  onChange,
  error,
}: {
  name: string | null;
  canChange: boolean;
  onChange: () => void;
  error?: string | false;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{t("diary.form.seizureType")}</span>
      <p className="m-0">{name ?? t("diary.form.seizureTypeNone")}</p>
      {canChange && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch self-start"
          onClick={onChange}
        >
          {t("diary.seizurePicker.change")}
        </Button>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Список вариантов с уже записанным значением, даже если справочник его не
 * знает: иначе селект молча подставил бы первый вариант, и сохранение
 * переписало бы лекарство или тип приступа, которого человек не трогал.
 */
/**
 * Лекарства, которые можно отметить в записи на эту дату: только действующие
 * по схеме врача в тот день, подписанные «Название, доза».
 *
 * Прежде список был всей историей схемы без доз: отменённый «Депакин» и
 * действующий выглядели одинаково, и отметка «дали» у отменённого показала бы
 * врачу приём того, что он сам отменил (аудит 26.11.2026, 1.4). Уже выбранное
 * в старой записи остаётся в списке через `withCurrent`.
 */
function medicationChoices(
  medications: MedicationOption[],
  occurredAt: string,
): NamedOption[] {
  const day = occurredAt.slice(0, 10);
  const known = /^\d{4}-\d{2}-\d{2}$/.test(day);
  return medications
    .filter(
      (medication) =>
        !known ||
        (medication.startedAt <= day &&
          (medication.stoppedAt === null || medication.stoppedAt >= day)),
    )
    .map((medication) => ({
      id: medication.id,
      name:
        medication.dose === ""
          ? medication.name
          : `${medication.name}, ${medication.dose}`,
    }));
}

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
  autoFocus = false,
}: {
  /** Сюда встаёт фокус при открытии формы, а не на время (FormSheet кита). */
  autoFocus?: boolean;
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
  const isNumeric =
    type === "number" || inputMode === "decimal" || inputMode === "numeric";
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
          className={cn("min-h-touch", isNumeric && "tabular-nums")}
          data-autofocus={autoFocus ? "" : undefined}
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
  autoFocus = false,
}: {
  autoFocus?: boolean;
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
          data-autofocus={autoFocus ? "" : undefined}
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
