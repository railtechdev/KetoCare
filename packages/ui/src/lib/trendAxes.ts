/**
 * Оси графика динамики — расчёт без отрисовки, чтобы его можно было проверить.
 *
 * Две ошибки, которые видно только на живом экране (обход 07.10.2026):
 * верх оси совпадал с единственным значением, и точка обрезалась краем;
 * подписи дней повторялись («07.10 07.10»), потому что ось времени ставила
 * несколько делений внутри одних суток.
 */

const DAY_MS = 86_400_000;

/** Полночь по местному времени: дни на оси — календарные дни семьи. */
export function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Пределы оси значений с запасом сверху и снизу.
 *
 * Запас — доля размаха, а у одного значения (или одинаковых) — доля самого
 * значения: иначе точка ложится на край и срезается наполовину. Ниже нуля ось
 * не уходит, если данные неотрицательные: «−0,2 ммоль/л» на шкале — неправда.
 */
export function valueDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(max) * 0.15, 1);
  const lower = min >= 0 ? Math.max(0, min - pad) : min - pad;
  return [round(lower), round(max + pad)];
}

/**
 * Пределы оси времени — целыми днями, и деления — по одному на день.
 *
 * Не больше `maxTicks` подписей: на 360 px месяц по дню в подпись не
 * читается, поэтому шаг растёт, но деление всегда стоит на полуночи, и двух
 * подписей одного дня не бывает.
 */
export function dayAxis(
  timestamps: readonly number[],
  maxTicks = 6,
): { domain: [number, number]; ticks: number[] } {
  if (timestamps.length === 0) return { domain: [0, DAY_MS], ticks: [0] };
  const first = startOfLocalDay(Math.min(...timestamps));
  const last = startOfLocalDay(Math.max(...timestamps));

  const days: number[] = [];
  for (let day = first; day <= last; day = nextDay(day)) days.push(day);

  const step = Math.max(1, Math.ceil(days.length / maxTicks));
  const ticks = days.filter((_, index) => index % step === 0);
  return { domain: [first, nextDay(last)], ticks };
}

/** Следующая полночь — календарём, а не «плюс сутки»: в дне перевода часов не 24 часа. */
function nextDay(ts: number): number {
  const date = new Date(ts);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
