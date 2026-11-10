import type { ProductOption } from "./useProducts";

/** Строка состава: продукт и его масса в граммах. */
export interface DishRow {
  product: ProductOption;
  grams: number;
  /** Подбор не меняет массу этой строки */
  pinned?: boolean;
}

/**
 * Вклад позиции в показатели блюда — то, что даёт её масса.
 *
 * Приходит от сервера (`/calc/verify`, позиция `dish.items`), и только
 * оттуда: умножить состав на 100 г в браузере просто, но это был бы второй
 * источник клинических чисел рядом с ядром, и однажды они разошлись бы.
 */
export interface ItemContribution {
  kcal: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
  fiber_g: number;
  net_carbs_g: number;
}

/** Продукты в формате, который ожидает `/calc/*`: значения на 100 г. */
export function toCalcIngredients(rows: DishRow[]) {
  return rows.map((row) => ({
    product_id: row.product.id,
    kcal: row.product.kcal,
    fat: row.product.fat,
    protein: row.product.protein,
    carbs: row.product.carbs,
    fiber: row.product.fiber,
  }));
}

/**
 * Границы подбора для закреплённых строк: нижняя равна верхней.
 *
 * `undefined`, когда закреплённых нет: границы не отправляются вовсе.
 */
export function pinnedBounds(
  rows: DishRow[],
): Record<string, [number, number]> | undefined {
  const pinned = rows.filter((row) => row.pinned === true);
  if (pinned.length === 0) return undefined;
  return Object.fromEntries(
    pinned.map((row) => [row.product.id, [row.grams, row.grams]]),
  );
}

export function toCalcItems(rows: DishRow[]) {
  return rows.map((row) => ({ product_id: row.product.id, grams: row.grams }));
}

/**
 * Что именно записывается: ребёнок, название и состав.
 *
 * По ней держится ключ попытки (`useAttemptKey`, ADR-0035): пока подпись та
 * же, повтор идёт с тем же ключом и второго блюда не создаёт; изменилась —
 * это уже другая запись, и ключ новый.
 */
export function dishSignature(
  patientId: string | null,
  title: string,
  rows: DishRow[],
): string {
  return JSON.stringify([
    patientId,
    title.trim(),
    rows.map((row) => [row.product.id, row.grams]),
  ]);
}
