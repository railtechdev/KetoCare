import type { ProductOption } from "./useProducts";

/** Строка состава: продукт и его масса в граммах. */
export interface DishRow {
  product: ProductOption;
  grams: number;
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
