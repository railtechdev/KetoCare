import type { ProductOption } from "./useProducts";

/** Строка состава: продукт и его масса в граммах. */
export interface DishRow {
  product: ProductOption;
  grams: number;
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

export function toCalcItems(rows: DishRow[]) {
  return rows.map((row) => ({ product_id: row.product.id, grams: row.grams }));
}
