/**
 * Время на экране дневников.
 *
 * Сервер принимает только aware datetime (`from`/`to` и `occurred_at`, раздел
 * 5.3 ТЗ), а поля ввода `date`/`datetime-local` отдают строку без смещения.
 * Разбирать её как UTC нельзя: запись сместилась бы на величину часового пояса
 * семьи, и приступ, случившийся ночью, попал бы в соседние сутки. Поэтому весь
 * разбор идёт через конструктор Date с раздельными компонентами — он всегда
 * трактует их как местное время, — а наружу уходит ISO со смещением.
 */

import { parseDateInput } from "@ketocare/ui";

// Разбор полей ввода живёт в ките: дневник ведут и кабинет, и Mini App
// (ADR-0044). Здесь он переэкспортируется, чтобы экраны кабинета не искали его
// в двух местах.
export {
  fromDateTimeLocalInput,
  parseDateInput,
  toDateInput,
  toDateTimeLocalInput,
} from "@ketocare/ui";

export type PeriodPreset = "week" | "month" | "custom";

/** Границы периода в ISO со смещением, обе включительно. */
export interface DiaryRange {
  from: string;
  to: string;
}

/**
 * Длины преднастроенных периодов в днях, считая сегодняшний.
 *
 * Месяц — 30 дней, а не «то же число месяцем раньше»: у второго варианта нет
 * ответа для 31-го числа, и период молча менял бы длину от месяца к месяцу.
 */
const PRESET_DAYS: Record<Exclude<PeriodPreset, "custom">, number> = {
  week: 7,
  month: 30,
};

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

/** Период «неделя»/«месяц» — назад от сегодняшнего дня включительно. */
export function presetRange(
  preset: Exclude<PeriodPreset, "custom">,
  now: Date,
): DiaryRange {
  const from = startOfDay(now);
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: from.toISOString(), to: endOfDay(now).toISOString() };
}

/**
 * Произвольный период из двух полей `date`.
 *
 * null — если границы заданы не полностью или перепутаны местами: такой запрос
 * сервер отклонит (`period_filter`), и отправлять его незачем.
 */
export function customRange(
  fromInput: string,
  toInput: string,
): DiaryRange | null {
  const from = parseDateInput(fromInput);
  const to = parseDateInput(toInput);
  if (from === null || to === null || from > to) return null;
  return { from: from.toISOString(), to: endOfDay(to).toISOString() };
}

/**
 * Дата вступления назначения в силу (`effective_from`, формат date) как местная
 * полночь: на графике маркер обязан стоять в том же поясе, что и точки.
 */
export function parseEffectiveFrom(value: string): Date | null {
  return parseDateInput(value);
}

/**
 * Подпись даты на оси графика. Локаль зафиксирована так же, как в
 * `formatOccurredAt` из packages/ui: интерфейс пока только русский (раздел 8.5 ТЗ).
 */
const CHART_DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

export function formatChartDate(date: Date): string {
  return CHART_DATE_FORMAT.format(date);
}
