import type { ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { useForm, type DefaultValues } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button, FormFooter, formatMass, formatRatio } from "@ketocare/ui";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import {
  FormErrorSummary,
  type FormErrorSummaryItem,
} from "../../components/FormErrorSummary";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  PrescriptionGoalPreview,
  usePrescriptionGoal,
} from "./PrescriptionGoalPreview";
import {
  FLUID_MAX,
  FLUID_MIN,
  KCAL_MAX,
  KCAL_MIN,
  prescriptionFormSchema,
  RATIO_CHOICES,
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
  { name: "fluidMlPerDay", anchor: "fluid", messageKey: "fluid" },
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

/** Пустое числовое поле: `valueAsNumber` даёт NaN, незаполненное — undefined. */
function isEmptyNumber(value: number | undefined): boolean {
  return value === undefined || Number.isNaN(value);
}

/** Число в поле поставила подсказка, и с тех пор его не меняли. */
function fromHint(value: number | undefined, filled: number | null): boolean {
  return filled !== null && value === filled;
}

/**
 * Подсказка пишет в поле, только если оно пусто или в нём её же прежнее число.
 * Перенесённое из прежней версии или набранное руками — выбор врача.
 */
function hintMayFill(value: number | undefined, filled: number | null) {
  return isEmptyNumber(value) || fromHint(value, filled);
}

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
  kcalHint,
}: {
  defaultValues: DefaultValues<PrescriptionFormValues>;
  /** Подсказка под калорийностью; получает функцию, ставящую число в поле */
  kcalHint?: (
    apply: (kcal: number, proteinG: number, fluidMl: number) => void,
  ) => ReactNode;
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
    watch,
    setValue,
    getValues,
    formState: { errors, submitCount, dirtyFields },
  } = useForm<PrescriptionFormValues>({
    resolver: zodResolver(prescriptionFormSchema),
    defaultValues,
  });

  // Углеводы считаются сами, как в KDC: (белок + углеводы) из калорийности и
  // соотношения минус белок. Поле остаётся правимым: правка руками выключает
  // пересчёт до конца этой формы. В уже записанном назначении число не
  // трогается, пока врач не поменял калорийность, соотношение или белок либо
  // не нажал «Поставить». Выше расчётного лимит не примет сервер.
  const goal = usePrescriptionGoal({
    ratio: watch("ratio"),
    kcalPerDay: watch("kcalPerDay"),
    proteinG: watch("proteinG"),
    mealsPerDay: watch("mealsPerDay"),
  });
  const [carbsByHand, setCarbsByHand] = useState(false);
  // Белок и жидкость из подсказки калорийности: число, которое подсказка
  // поставила в поле в этой форме. Подставлять можно только в пустое поле или
  // поверх своего же прежнего числа. Значение, перенесённое из действующей
  // версии назначения, — выбор врача, и подсказка его не перезаписывает.
  const [proteinFromHint, setProteinFromHint] = useState<number | null>(null);
  const [fluidFromHint, setFluidFromHint] = useState<number | null>(null);
  const proteinValue = watch("proteinG");
  const fluidValue = watch("fluidMlPerDay");
  // Расчёт — только для ТЕКУЩИХ полей. Пока ответ на новые числа не пришёл,
  // запрос держит прежний (`keepPreviousData`), и его углеводы относятся к
  // другим калорийности или белку: подставлять их в поле и подписывать
  // «рассчитано» нельзя (аудит расчётов 13.11.2026).
  const derivedCarbs = goal.isPlaceholderData
    ? null
    : (goal.data?.day.net_carbs_g ?? null);
  const derivedCarbsShown =
    derivedCarbs === null ? null : Math.round(derivedCarbs * 10) / 10;
  const inputsChanged =
    dirtyFields.kcalPerDay === true ||
    dirtyFields.ratio === true ||
    dirtyFields.proteinG === true;
  const carbsEmpty = Number.isNaN(defaultValues.carbsLimitG ?? Number.NaN);
  // Следует ли поле расчёту. Включается один раз — пустым полем, первой
  // правкой калорийности, соотношения или белка либо кнопкой «Поставить» — и
  // дальше не выключается, кроме ручной правки. Пока условием было «поля
  // изменены сейчас», врач, вернувший калорийность к прежней, оставался с
  // промежуточным числом в поле.
  const [carbsLatched, setCarbsLatched] = useState(carbsEmpty);
  if (inputsChanged && !carbsLatched) setCarbsLatched(true);
  const carbsFollow = carbsLatched || inputsChanged;
  useEffect(() => {
    if (derivedCarbsShown === null || carbsByHand || !carbsFollow) return;
    setValue("carbsLimitG", derivedCarbsShown, { shouldValidate: true });
  }, [derivedCarbsShown, carbsByHand, carbsFollow, setValue]);

  // Число, перенесённое из действующей версии, могло быть посчитано прежним
  // правилом или введено руками до автоматического расчёта. Молча его не
  // меняем — это выбор врача, — но и пояснение «рассчитано» под ним было бы
  // неправдой: так у пациента стояло 27,7 г при расчётных 6,7 г, и врач не
  // видела, как это исправить (замечание медиков 13.11.2026). Расхождение
  // называется, и расчётное число ставится одной кнопкой.
  const carbsValue = watch("carbsLimitG");
  const carbsMatchDerived =
    derivedCarbsShown !== null &&
    Number.isFinite(carbsValue) &&
    Math.abs(carbsValue - derivedCarbsShown) < 0.05;
  const staleCarbsFix =
    derivedCarbsShown !== null &&
    !carbsFollow &&
    Number.isFinite(carbsValue) &&
    !carbsMatchDerived
      ? derivedCarbsShown
      : null;
  // Набранное руками тоже сверяется с расчётом: выше расчётного сервер
  // назначение не примет, и врач должен видеть число до отправки.
  const manualCarbsFix =
    derivedCarbsShown !== null &&
    carbsByHand &&
    Number.isFinite(carbsValue) &&
    !carbsMatchDerived
      ? derivedCarbsShown
      : null;
  const carbsFix = carbsByHand ? manualCarbsFix : staleCarbsFix;
  const applyDerivedCarbs = (derived: number) => {
    setValue("carbsLimitG", derived, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setCarbsByHand(false);
    setCarbsLatched(true);
  };

  // Пустое поле без расчёта молчало, и диетолог набирала лимит руками,
  // сверяясь с KDC (замечание 14.11.2026): расчёт ждал кетосоотношения, а
  // форма об этом не говорила. Теперь поле называет, чего не хватает.
  const ratioValue = watch("ratio");
  const kcalValue = watch("kcalPerDay");
  const missingForCarbs = [
    ...(Number.isFinite(ratioValue) && ratioValue >= 1
      ? []
      : [t("prescription.carbsNeeds.ratio")]),
    ...(Number.isFinite(kcalValue) && kcalValue > 0
      ? []
      : [t("prescription.carbsNeeds.kcal")]),
    ...(Number.isFinite(proteinValue) && proteinValue >= 0
      ? []
      : [t("prescription.carbsNeeds.protein")]),
  ];
  const carbsWaiting =
    !Number.isFinite(carbsValue) && missingForCarbs.length > 0
      ? t("prescription.carbsWaiting", { missing: missingForCarbs.join(", ") })
      : null;
  const messageFor = (field: (typeof VALIDATED_FIELDS)[number]) =>
    field.name === "carbsLimitG" && carbsWaiting !== null
      ? carbsWaiting
      : t(`prescription.errors.${field.messageKey}`);

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
          message: messageFor(field),
        }));

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="@container flex flex-col gap-section"
    >
      <FormErrorSummary
        title={t("prescription.errorSummary")}
        items={summary}
        focusKey={submitCount}
      />

      {/* Несколько колонок — исключение для парных числовых показателей
          назначения: врач сверяет их между собой на одном экране. Четыре в
          ряд — только в форме от 80rem (монитор): у́же подпись «Жидкость, мл в
          сутки (необязательно)» переносилась на вторую строку, и поле
          вставало ниже соседей (снимок заказчика 13.11.2026). На ноутбуке —
          две колонки, на узком экране одна (правило П6 канона). */}
      <div className="grid gap-section @sm:grid-cols-2 @7xl:grid-cols-4">
        {/* Список, а не свободное число: врач мыслит «4 : 1», а поле
            показывало «4». Значения те же, что уже разрешены схемой (шаг 0,5
            от 1 до 5), новых состояний не появляется — меняется только способ
            ввода и класс ошибок вместе с ним. */}
        <SelectField
          id={`${ids}-ratio`}
          width="narrow"
          label={t("fields.ratio")}
          error={errors.ratio && t("prescription.errors.ratio")}
          {...register("ratio", { valueAsNumber: true })}
        >
          {/* Пустой вариант первым: без него браузер выбирал первый из
              списка — 5 : 1, максимум, — и первое назначение уходило с ним,
              если врач не заметил поля. Кетосоотношение выбирается явно
              (клинический риск); у новой версии оно приходит из действующей. */}
          <option value="">{t("fields.ratioPlaceholder")}</option>
          {RATIO_CHOICES.map((value) => (
            <option key={value} value={value}>
              {formatRatio(value)}
            </option>
          ))}
        </SelectField>

        <Field
          id={`${ids}-kcal`}
          width="narrow"
          type="number"
          inputMode="decimal"
          min={KCAL_MIN}
          max={KCAL_MAX}
          step={10}
          label={t("fields.kcalInput")}
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
          label={t("fields.proteinInput")}
          error={errors.proteinG && t("prescription.errors.protein")}
          hint={
            fromHint(proteinValue, proteinFromHint)
              ? t("prescription.proteinDerived")
              : undefined
          }
          {...register("proteinG", { valueAsNumber: true })}
        />

        <Field
          id={`${ids}-carbs`}
          width="narrow"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          label={t("fields.carbsLimitInput")}
          error={
            errors.carbsLimitG &&
            (carbsWaiting ?? t("prescription.errors.carbsLimit"))
          }
          hint={
            carbsFix !== null ? (
              <>
                {t(
                  !carbsByHand
                    ? "prescription.carbsStale"
                    : carbsValue > carbsFix
                      ? "prescription.carbsManualOver"
                      : "prescription.carbsManual",
                  { derived: formatMass(carbsFix) },
                )}{" "}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyDerivedCarbs(carbsFix)}
                >
                  {t("prescription.carbsApply", {
                    derived: formatMass(carbsFix),
                  })}
                </Button>
              </>
            ) : carbsMatchDerived ? (
              t("prescription.carbsDerived")
            ) : errors.carbsLimitG ? undefined : (
              (carbsWaiting ?? undefined)
            )
          }
          {...register("carbsLimitG", {
            valueAsNumber: true,
            onChange: () => setCarbsByHand(true),
            // Очищенное поле возвращается к расчёту: пустой лимит — это не
            // выбор врача, а «посчитай сам».
            onBlur: (event: { target: { value: string } }) => {
              if (event.target.value.trim() !== "") return;
              setCarbsByHand(false);
              setCarbsLatched(true);
            },
          })}
        />

        {/* Подсказка калорийности — своей строкой во всю ширину под первым
            рядом, а не ячейкой сетки: ячейкой она сдвигала соседние поля и
            разрывала ряд показателей (аудит продукта 12.11.2026). Пустая —
            не занимает места. */}
        <div className="col-span-full empty:hidden">
          {kcalHint?.((kcal, proteinG, fluidMl) => {
            setValue("kcalPerDay", kcal, {
              shouldDirty: true,
              shouldValidate: true,
            });
            // Белок идёт за калорийностью, как в KDC: 1 г на кг веса.
            if (hintMayFill(getValues("proteinG"), proteinFromHint)) {
              setValue("proteinG", proteinG, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setProteinFromHint(proteinG);
            }
            // Жидкость — тоже по весу (Холлидей — Сегар, ADR-0069).
            if (hintMayFill(getValues("fluidMlPerDay"), fluidFromHint)) {
              setValue("fluidMlPerDay", fluidMl, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setFluidFromHint(fluidMl);
            }
          })}
        </div>

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

        {/* Необязательное: пустое поле — жидкость не назначена, и семья её
            нигде не видит. */}
        <Field
          id={`${ids}-fluid`}
          width="narrow"
          type="number"
          inputMode="numeric"
          min={FLUID_MIN}
          max={FLUID_MAX}
          step={1}
          optional
          label={t("fields.fluidInput")}
          error={errors.fluidMlPerDay && t("prescription.errors.fluid")}
          hint={
            fromHint(fluidValue, fluidFromHint)
              ? t("prescription.fluidDerived")
              : undefined
          }
          {...register("fluidMlPerDay", { valueAsNumber: true })}
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

      {/* Граммы цели и ограничения — рядом: оба блока узкие, и столбиком
          они добавляли форме полэкрана. */}
      <div className="grid items-start gap-section @3xl:grid-cols-2">
        <PrescriptionGoalPreview
          input={{
            ratio: watch("ratio"),
            kcalPerDay: watch("kcalPerDay"),
            proteinG: watch("proteinG"),
            mealsPerDay: watch("mealsPerDay"),
          }}
        />

        <TextAreaField
          id={`${ids}-restrictions`}
          rows={2}
          optional
          label={t("fields.restrictions")}
          placeholder={t("prescription.restrictionsPlaceholder")}
          {...register("restrictions")}
        />
      </div>

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
