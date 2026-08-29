import { parseDateInput } from "../diary/time";

/**
 * Даты в кабинете врача.
 *
 * Все даты API (`birth_date`, `effective_from`, `started_at`) приходят строкой
 * `YYYY-MM-DD` без времени и зоны. Разбирать их через `new Date("2026-08-28")`
 * нельзя: такая запись трактуется как полночь UTC, и западнее Гринвича дата
 * съезжает на сутки назад — возраст ребёнка и дата начала приёма препарата
 * показывались бы неверно.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Дата `YYYY-MM-DD` в локальном формате; null — строку не разобрать. */
export function formatIsoDate(value: string): string | null {
  const date = parseDateInput(value);
  return date === null ? null : DATE_FORMAT.format(date);
}

/** Момент `created_at` (ISO со смещением) в локальном формате. */
export function formatTimestamp(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_TIME_FORMAT.format(date);
}

/**
 * Возраст в полных месяцах на дату `on`; null — дату рождения не разобрать или
 * она в будущем.
 *
 * Месяцы, а не годы: кетодиетотерапию начинают и на первом году жизни, и
 * округление до «0 лет» стёрло бы разницу между младенцем и двухлеткой.
 */
export function ageInMonths(birthDate: string, on: Date): number | null {
  const born = parseDateInput(birthDate);
  if (born === null) return null;

  let months =
    (on.getFullYear() - born.getFullYear()) * 12 +
    (on.getMonth() - born.getMonth());

  // Месяц засчитывается только с наступлением числа рождения: иначе ребёнку,
  // родившемуся 30-го, возраст прибавлялся бы 1-го числа.
  if (on.getDate() < born.getDate()) months -= 1;

  return months < 0 ? null : months;
}
