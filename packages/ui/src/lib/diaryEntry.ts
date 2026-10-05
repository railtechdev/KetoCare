import { z } from "zod";

/**
 * Запись дневника: проверка ввода и тело запроса (раздел 7.3 ТЗ).
 *
 * Живёт в ките, а не в приложении: дневник ведут и в кабинете, и в Mini App
 * (ADR-0044), и границы «кетоны 0–12, вес 2–150», правило «секунды или
 * интервал, но не оба» (ADR-0020) и разбор местного времени обязаны быть
 * одними и теми же в обоих каналах. Копия в каждом приложении однажды
 * разошлась бы — и одна семья слышала бы о той же записи разное.
 *
 * Поля хранятся строками — такими их отдаёт DOM, — а преобразование в тело
 * запроса вынесено в отдельные функции ниже: они тестируются без React и не
 * зависят от разметки. Сообщения об ошибках здесь не задаются: их текст берётся
 * из словаря приложения (раздел 8.5 ТЗ).
 *
 * Проверки повторяют серверные (`apps/api/src/api/schemas_logs.py`) и служат
 * подсказкой при вводе. Решение принимает сервер: его сообщение и показывается,
 * если ответ пришёл с ошибкой.
 */

// --- местное время полей ввода -------------------------------------------
//
// Сервер принимает только aware datetime, а поля `date`/`datetime-local` отдают
// строку без смещения. Разбирать её как UTC нельзя: запись сместилась бы на
// величину часового пояса семьи, и приступ, случившийся ночью, попал бы в
// соседние сутки. Поэтому разбор идёт через конструктор Date с раздельными
// компонентами — он трактует их как местное время, — а наружу уходит ISO.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Дата из поля `date` (YYYY-MM-DD) как местная полночь. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // Date нормализует переполнение (32 января -> 1 февраля), поэтому результат
  // сверяется с исходными числами: иначе несуществующая дата прошла бы молча.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDateTimeLocalInput(date: Date): string {
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Момент из поля `datetime-local` в ISO со смещением; null — если ввод не разобрать. */
export function fromDateTimeLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (match === null) return null;

  const day = parseDateInput(`${match[1]}-${match[2]}-${match[3]}`);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (day === null || hours > 23 || minutes > 59) return null;

  day.setHours(hours, minutes, 0, 0);
  return day.toISOString();
}

// --- тело запроса ----------------------------------------------------------
//
// Повторяет `*LogCreate` из OpenAPI. Свои типы, а не сгенерированные: у кита
// нет зависимости от клиента API, а структурной совместимости достаточно —
// приложение передаёт это тело в сгенерированный вызов, и расхождение поля
// ловит компилятор там.

export type DiaryEntryKind =
  "seizures" | "ketones" | "weight" | "medications" | "meals" | "side-effects";

/**
 * Тело записи из формы.
 *
 * Одно и то же тело годится и для POST, и для PATCH: схема изменения повторяет
 * схему создания, но с необязательными полями. Форма показывает все поля сразу,
 * поэтому и при изменении отправляются все — очищенное поле должно очиститься.
 */
export type DiaryEntryBody =
  | {
      kind: "seizures";
      body: {
        occurred_at: string;
        seizure_type_id: string;
        duration_sec: number | null;
        duration_option_id: string | null;
        count: number;
        description: string | null;
        triggers: string | null;
      };
    }
  | {
      kind: "ketones";
      body: { occurred_at: string; value: number; method: "blood" | "urine" };
    }
  | {
      kind: "weight";
      body: {
        occurred_at: string;
        weight_kg: number;
        height_cm: number | null;
      };
    }
  | {
      kind: "medications";
      body: { occurred_at: string; medication_id: string; taken: boolean };
    }
  | { kind: "meals"; body: { occurred_at: string; free_text: string } }
  | {
      kind: "side-effects";
      body: {
        occurred_at: string;
        symptom: string;
        description: string | null;
      };
    };

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

/**
 * На сколько момент события может опережать часы — зеркало
 * `OCCURRED_AT_CLOCK_SKEW` в `schemas_logs.py`, как и технические границы ниже.
 *
 * Сервер проверяет сам и отклонит запись из будущего в любом случае. Здесь
 * проверка нужна ради причины: сервер отвечает общим «проверьте правильность
 * заполнения полей», и семья не узнала бы, что ошиблась именно в дате.
 */
export const OCCURRED_AT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Код ошибки поля «когда»: время ещё не наступило. */
export const OCCURRED_AT_FUTURE = "future";

/** Код ошибки поля интервала: заполнены и секунды, и интервал (ADR-0020). */
export const DURATIONS_BOTH = "both-durations";

/** Момент события: поле `datetime-local` в местном времени семьи. */
const occurredAt = z
  .string()
  .refine((value) => fromDateTimeLocalInput(value) !== null)
  .refine(
    (value) => {
      const iso = fromDateTimeLocalInput(value);
      return (
        iso === null ||
        new Date(iso).getTime() <= Date.now() + OCCURRED_AT_CLOCK_SKEW_MS
      );
    },
    { message: OCCURRED_AT_FUTURE },
  );

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
    { path: ["durationOptionId"], message: DURATIONS_BOTH },
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
export function seizureBody(values: SeizureValues): DiaryEntryBody | null {
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

export function ketoneBody(values: KetoneValues): DiaryEntryBody | null {
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

export function weightBody(values: WeightValues): DiaryEntryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "weight",
    body: {
      occurred_at,
      // weight:raw — число уходит на сервер, а не на экран.
      weight_kg: Number(values.weightKg),
      height_cm: optionalNumberOf(values.heightCm),
    },
  };
}

export function medicationBody(
  values: MedicationValues,
): DiaryEntryBody | null {
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

export function mealBody(values: MealValues): DiaryEntryBody | null {
  const occurred_at = fromDateTimeLocalInput(values.occurredAt);
  if (occurred_at === null) return null;

  return {
    kind: "meals",
    body: { occurred_at, free_text: values.freeText.trim() },
  };
}

export function sideEffectBody(
  values: SideEffectValues,
): DiaryEntryBody | null {
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

/**
 * Ошибки полей одной проверкой: поле → код причины.
 *
 * Для экранов без react-hook-form (Mini App): форма там — несколько полей в
 * состоянии компонента, и тащить ради неё вторую библиотеку форм незачем.
 * Код — `OCCURRED_AT_FUTURE`, `DURATIONS_BOTH` или любое иное непустое
 * сообщение («значение не годится»); текст для человека берёт словарь.
 */
export function diaryFieldErrors(
  schema: z.ZodTypeAny,
  values: unknown,
): Record<string, string> {
  const result = schema.safeParse(values);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in errors)) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
