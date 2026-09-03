import { z } from "zod";

import type { DiaryBody } from "./diaryApi";
import { fromDateTimeLocalInput } from "./time";

/**
 * Схемы форм дневников (react-hook-form + zod, раздел 3 ТЗ).
 *
 * Поля хранятся строками — такими их отдаёт DOM, — а преобразование в тело
 * запроса вынесено в отдельные функции ниже: они тестируются без React и не
 * зависят от разметки. Сообщения об ошибках здесь не задаются: их текст берётся
 * из словаря компонентом (раздел 8.5 ТЗ).
 *
 * Проверки повторяют серверные (`apps/api/src/api/schemas_logs.py`) и служат
 * подсказкой при вводе. Решение принимает сервер: его сообщение и показывается,
 * если ответ пришёл с ошибкой.
 */

/**
 * Раздел 7.3 ТЗ: «кетоны 0–12 ммоль/л, вес 2–150 кг». Значения взяты оттуда и
 * нигде больше не выводятся: медицинские границы не выдумываются (правило 1
 * CLAUDE.md).
 */
export const KETONE_MIN_MMOL = 0;
export const KETONE_MAX_MMOL = 12;
export const WEIGHT_MIN_KG = 2;
export const WEIGHT_MAX_KG = 150;

/** Минимальное число приступов в записи — техническая граница сервера. */
export const SEIZURE_COUNT_MIN = 1;

function isNumberWithin(value: string, min: number, max: number): boolean {
  const parsed = Number(value);
  return (
    value.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= min &&
    parsed <= max
  );
}

const number = (min: number, max: number) =>
  z.string().refine((value) => isNumberWithin(value, min, max));

const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .refine((value) => value.trim() === "" || isNumberWithin(value, min, max));

const optionalInteger = (min: number, max: number) =>
  z
    .string()
    .refine(
      (value) =>
        value.trim() === "" ||
        (isNumberWithin(value, min, max) && Number.isInteger(Number(value))),
    );

const integer = (min: number, max: number) =>
  z
    .string()
    .refine(
      (value) =>
        isNumberWithin(value, min, max) && Number.isInteger(Number(value)),
    );

/** Момент события: поле `datetime-local` в местном времени семьи. */
const occurredAt = z
  .string()
  .refine((value) => fromDateTimeLocalInput(value) !== null);

const requiredText = z.string().trim().min(1);
const freeText = z.string();
const requiredId = z.string().min(1);

// Технические границы сервера (schemas_logs.py): защищают БД, а не пациента.
const DURATION_MAX_SEC = 86_400;
const SEIZURE_COUNT_MAX = 1_000;
const HEIGHT_MAX_CM = 250;

export const seizureSchema = z
  .object({
    occurredAt,
    seizureTypeId: requiredId,
    durationSec: optionalInteger(0, DURATION_MAX_SEC),
    // Интервал со слов семьи — вариант шкалы из справочника анкеты. Пустая
    // строка означает «не отвечали», а не «ноль».
    durationOptionId: z.string(),
    count: integer(SEIZURE_COUNT_MIN, SEIZURE_COUNT_MAX),
    description: freeText,
    triggers: freeText,
  })
  // Одно из двух, а не оба: измеренная длительность и интервал со слов —
  // разные величины, и два ответа об одной величине однажды разойдутся
  // (ADR-0020). Сервер это тоже проверяет; здесь — чтобы человек узнал об
  // этом до отправки, а не из ответа с ошибкой.
  .refine(
    (values) =>
      values.durationSec.trim() === "" || values.durationOptionId === "",
    { path: ["durationOptionId"], message: "both-durations" },
  );

export const ketoneSchema = z.object({
  occurredAt,
  value: number(KETONE_MIN_MMOL, KETONE_MAX_MMOL),
  method: z.enum(["blood", "urine"]),
});

export const weightSchema = z.object({
  occurredAt,
  weightKg: number(WEIGHT_MIN_KG, WEIGHT_MAX_KG),
  heightCm: optionalNumber(1, HEIGHT_MAX_CM),
});

export const medicationSchema = z.object({
  occurredAt,
  medicationId: requiredId,
  taken: z.boolean(),
});

export const mealSchema = z.object({
  occurredAt,
  freeText: requiredText,
});

export const sideEffectSchema = z.object({
  occurredAt,
  symptom: requiredText,
  description: freeText,
});

export type SeizureValues = z.infer<typeof seizureSchema>;
export type KetoneValues = z.infer<typeof ketoneSchema>;
export type WeightValues = z.infer<typeof weightSchema>;
export type MedicationValues = z.infer<typeof medicationSchema>;
export type MealValues = z.infer<typeof mealSchema>;
export type SideEffectValues = z.infer<typeof sideEffectSchema>;

/** Пустое необязательное поле — это null, а не 0 и не пустая строка. */
function optionalNumberOf(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function optionalTextOf(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Тело запроса из значений формы; null — если момент события не разобрать.
 *
 * До сюда невалидное значение не доходит (его отсекает схема), но собирать тело
 * запроса «как получится» в клиническом дневнике нельзя: лучше не отправить
 * запись, чем отправить со сбитым временем.
 */
export function seizureBody(values: SeizureValues): DiaryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "seizures",
    body: {
      occurred_at,
      seizure_type_id: values.seizureTypeId,
      duration_sec: optionalNumberOf(values.durationSec),
      duration_option_id:
        values.durationOptionId === "" ? null : values.durationOptionId,
      count: Number(values.count),
      description: optionalTextOf(values.description),
      triggers: optionalTextOf(values.triggers),
    },
  };
}

export function ketoneBody(values: KetoneValues): DiaryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "ketones",
    body: {
      occurred_at,
      value: Number(values.value),
      method: values.method,
    },
  };
}

export function weightBody(values: WeightValues): DiaryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "weight",
    body: {
      occurred_at,
      weight_kg: Number(values.weightKg),
      height_cm: optionalNumberOf(values.heightCm),
    },
  };
}

export function medicationBody(values: MedicationValues): DiaryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "medications",
    body: {
      occurred_at,
      medication_id: values.medicationId,
      taken: values.taken,
    },
  };
}

export function mealBody(values: MealValues): DiaryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "meals",
    body: { occurred_at, free_text: values.freeText.trim() },
  };
}

export function sideEffectBody(values: SideEffectValues): DiaryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "side-effects",
    body: {
      occurred_at,
      symptom: values.symptom.trim(),
      description: optionalTextOf(values.description),
    },
  };
}
