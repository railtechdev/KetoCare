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

/**
 * Поля графика. Подписи черт смены назначения стоят над верхним краем
 * области построения, и с полем в 8 px верх подписи срезался (аудит Mini App
 * 21.11.2026, Д5). Поле растёт только у графика с чертами и ровно на столько
 * рядов подписей, сколько занято (см. {@link markerLabelRows}): без них лишняя
 * полоса сверху — пустое место на телефоне.
 */
export const MARKER_LABEL_ROOM = 24;

/** Шаг между рядами подписей черт — строка шрифта 11 px с просветом. */
export const MARKER_ROW_STEP = 14;

/** Больше двух рядов подписи над графиком не читаются — это уже столбик. */
export const MARKER_LABEL_ROWS = 2;

export function chartMargin(labelRows: number): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top:
      labelRows > 0 ? MARKER_LABEL_ROOM + (labelRows - 1) * MARKER_ROW_STEP : 8,
    right: 8,
    bottom: 8,
    left: 0,
  };
}

/**
 * Ширина области построения, пока контейнер не измерен: телефон 360 px без
 * полей экрана, блока и оси значений. Ошибиться в узкую сторону безопасно —
 * подписи только раньше разойдутся по рядам.
 */
export const PHONE_PLOT_WIDTH = 250;

/** Ширина подписи черты шрифтом 11 px с просветом — оценкой, без замера текста. */
export function markerLabelWidth(label: string): number {
  return label.length * 7 + 6;
}

/**
 * Ряд подписи каждой черты смены назначения: 0 — нижний, `null` — без
 * подписи.
 *
 * При постепенном вводе диеты соотношение поднимают каждые один-три дня
 * (1:1 → 2:1 → 3:1 → 4:1), и подписи соседних черт на 360 px ложились одна
 * на другую — «3.53.53.5:1» (аудит Mini App, Д5). Именно этот участок графика
 * семья и врач и читают. Поэтому подписи, которые не разошлись бы по
 * горизонтали, встают рядом выше; не уместившиеся в {@link MARKER_LABEL_ROWS}
 * ряда остаются чертой без подписи. Раскладка идёт от последней черты к
 * первой: действующее назначение подписано всегда и всегда в нижнем ряду.
 *
 * Черты вне оси времени recharts не рисует — у них и подписи нет.
 */
export function markerLabelRows(
  markers: readonly { ts: number; label: string }[],
  domain: readonly [number, number],
  plotWidth: number = PHONE_PLOT_WIDTH,
): (number | null)[] {
  const [from, to] = domain;
  const span = to - from;
  const rows: [number, number][][] = Array.from(
    { length: MARKER_LABEL_ROWS },
    () => [],
  );
  const result: (number | null)[] = markers.map(() => null);
  const order = markers
    .map((marker, index) => ({ ...marker, index }))
    .filter((marker) => marker.ts >= from && marker.ts <= to)
    .sort((a, b) => b.ts - a.ts);
  for (const marker of order) {
    const x = span > 0 ? ((marker.ts - from) / span) * plotWidth : 0;
    const half = markerLabelWidth(marker.label) / 2;
    const left = x - half;
    const right = x + half;
    const row = rows.findIndex((placed) =>
      placed.every(([start, end]) => right <= start || left >= end),
    );
    if (row === -1) continue;
    rows[row]?.push([left, right]);
    result[marker.index] = row;
  }
  return result;
}
