import type { DiaryLog } from "./diaryApi";
import type { DictionaryOption } from "./useDiary";

/**
 * Части суток из дневника KETO-STEP, присланного заказчиком: утро, день,
 * вечер, ночь по шесть часов (ADR-0007).
 *
 * Границы взяты из документа буквально. Клетка «5A» в бумажном дневнике значит
 * «пять абсансов утром» — здесь то же самое, только собранное из записей, а не
 * записанное рукой: событие хранит точное время, длительность и повод, и
 * сводить его к числу в клетке при хранении нельзя.
 */
export const DAY_PARTS = [
  { key: "morning", fromHour: 6, toHour: 12 },
  { key: "afternoon", fromHour: 12, toHour: 18 },
  { key: "evening", fromHour: 18, toHour: 24 },
  { key: "night", fromHour: 0, toHour: 6 },
] as const;

export type DayPartKey = (typeof DAY_PARTS)[number]["key"];

/** Сколько приступов каждого типа пришлось на клетку. */
export interface GridCell {
  /** Код типа (или название, если кода нет) → число приступов */
  byType: { label: string; count: number }[];
  total: number;
}

export interface GridRow {
  /** Местная дата в формате YYYY-MM-DD — ключ строки и подпись */
  date: string;
  cells: Record<DayPartKey, GridCell>;
  total: number;
}

export interface SeizureGridData {
  rows: GridRow[];
  total: number;
}

function partOf(hour: number): DayPartKey {
  const part = DAY_PARTS.find(
    (candidate) => hour >= candidate.fromHour && hour < candidate.toHour,
  );
  // Часы 0-23 покрыты полностью, ветка недостижима; возврат вместо исключения
  // на случай, если границы однажды изменит медицинская команда.
  return part?.key ?? "night";
}

function emptyCells(): Record<DayPartKey, GridCell> {
  return {
    morning: { byType: [], total: 0 },
    afternoon: { byType: [], total: 0 },
    evening: { byType: [], total: 0 },
    night: { byType: [], total: 0 },
  };
}

function localDate(value: string): string {
  const at = new Date(value);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * Записи приступов → сетка «день × часть суток».
 *
 * Дни берутся из самих записей, а не из календаря периода: строка «приступов
 * не было» ничего не сообщает, а тридцать таких строк прячут те дни, когда
 * приступы были. Итог за период считается здесь же — в бумажном дневнике он
 * стоит внизу таблицы.
 *
 * Подпись клетки — код типа («TC»), а если кода нет, полное название: коды
 * проставлены не всем типам, и молча пропускать такие приступы нельзя.
 */
export function buildSeizureGrid(
  logs: readonly DiaryLog[],
  types: readonly DictionaryOption[],
): SeizureGridData {
  const labelById = new Map(
    types.map((type) => [type.id, type.code ?? type.name] as const),
  );

  const rowsByDate = new Map<string, GridRow>();
  let total = 0;

  for (const log of logs) {
    if (log.kind !== "seizures") continue;

    const date = localDate(log.occurred_at);
    let row = rowsByDate.get(date);
    if (row === undefined) {
      row = { date, cells: emptyCells(), total: 0 };
      rowsByDate.set(date, row);
    }

    const cell = row.cells[partOf(new Date(log.occurred_at).getHours())];
    const label = labelById.get(log.seizure_type_id) ?? "?";
    // Число приступов берётся из записи: одна запись может описывать серию, и
    // считать записи вместо приступов значило бы занизить картину.
    const count = log.count;

    const existing = cell.byType.find((entry) => entry.label === label);
    if (existing === undefined) cell.byType.push({ label, count });
    else existing.count += count;

    cell.total += count;
    row.total += count;
    total += count;
  }

  const rows = [...rowsByDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return { rows, total };
}

/** Клетка в записи бумажного дневника: «5A», «2TC 1M», пусто. */
export function formatCell(cell: GridCell): string {
  return cell.byType
    .map((entry) => `${entry.count}${entry.label}`)
    .join(" ");
}
