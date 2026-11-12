/**
 * Блок «За 30 дней» в «Обзоре» карты: период и раскладка по неделям.
 *
 * Здесь только счёт и выбор крайних значений — никакой медицинской арифметики:
 * числа приходят из отчёта (`GET /patients/{id}/report`), тот же источник, что и
 * экран «Отчёт», поэтому «Обзор» и «Отчёт» за тот же период не расходятся.
 */

/** Длина периода блока, дней — включая сегодня. */
export const LAST_DAYS = 30;

/** Неделя для раскладки приступов: границы включительно, `YYYY-MM-DD`. */
export interface WeekCount {
  from: string;
  to: string;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Календарная дата `YYYY-MM-DD` → полночь UTC: шаг в сутки без летнего времени. */
function utcDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return Date.UTC(year, month - 1, day);
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Начало периода в `days` дней, заканчивающегося `to` включительно. */
export function periodStart(to: string, days: number = LAST_DAYS): string {
  return isoOf(utcDay(to) - (days - 1) * DAY_MS);
}

/**
 * Приступы по неделям: семидневные окна, отсчитанные назад от `to`, новые
 * первыми. Окон столько, сколько целых недель помещается в период (за 30 дней —
 * четыре): неполная неделя рядом с полными читалась бы как спад.
 *
 * Ключи `byDay` — даты, которые отдаёт отчёт; чужие и вне окон не считаются.
 */
export function seizuresByWeek(
  byDay: Record<string, number>,
  to: string,
  days: number = LAST_DAYS,
): WeekCount[] {
  const end = utcDay(to);
  const weeks = Math.floor(days / 7);
  const result: WeekCount[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const weekEnd = end - week * 7 * DAY_MS;
    const weekStart = weekEnd - 6 * DAY_MS;
    let count = 0;
    for (const [day, value] of Object.entries(byDay)) {
      const at = utcDay(day);
      if (!Number.isNaN(at) && at >= weekStart && at <= weekEnd) count += value;
    }
    result.push({ from: isoOf(weekStart), to: isoOf(weekEnd), count });
  }
  return result;
}

/** Замер ряда отчёта. */
export interface SeriesPoint {
  at: string;
  value: number;
}

/**
 * Первый и последний замер ряда по времени, а не по порядку в ответе: порядок
 * точек сервер не обещает.
 */
export function firstAndLast(
  points: readonly SeriesPoint[],
): { first: SeriesPoint; last: SeriesPoint } | null {
  if (points.length === 0) return null;
  let first = points[0] as SeriesPoint;
  let last = first;
  for (const point of points) {
    if (Date.parse(point.at) < Date.parse(first.at)) first = point;
    if (Date.parse(point.at) >= Date.parse(last.at)) last = point;
  }
  return { first, last };
}
