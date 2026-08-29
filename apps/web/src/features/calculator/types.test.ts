// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toCalcIngredients, toCalcItems, type DishRow } from "./types";

const ROWS: DishRow[] = [
  {
    product: {
      id: "p1",
      name: "Масло сливочное",
      kcal: 717,
      fat: 81.1,
      protein: 0.9,
      carbs: 0.1,
      fiber: 0,
    },
    grams: 50,
  },
  {
    product: {
      id: "p2",
      name: "Куриная грудка",
      kcal: 165,
      fat: 3.6,
      protein: 31,
      carbs: 0,
      fiber: 0,
    },
    grams: 40,
  },
];

describe("подготовка состава для /calc", () => {
  it("ingredients несут значения на 100 г, без масс", () => {
    // Ядро принимает состав и массы раздельно (раздел 6.1 ТЗ): смешивать их
    // в одну структуру нельзя — verify() ждёт пары (Ingredient, граммы).
    const ingredients = toCalcIngredients(ROWS);
    expect(ingredients).toEqual([
      {
        product_id: "p1",
        kcal: 717,
        fat: 81.1,
        protein: 0.9,
        carbs: 0.1,
        fiber: 0,
      },
      {
        product_id: "p2",
        kcal: 165,
        fat: 3.6,
        protein: 31,
        carbs: 0,
        fiber: 0,
      },
    ]);
    expect(ingredients[0]).not.toHaveProperty("grams");
  });

  it("items несут только идентификатор и массу", () => {
    expect(toCalcItems(ROWS)).toEqual([
      { product_id: "p1", grams: 50 },
      { product_id: "p2", grams: 40 },
    ]);
  });

  it("порядок сохраняется — состав и массы сопоставляются по product_id", () => {
    const ingredients = toCalcIngredients(ROWS);
    const items = toCalcItems(ROWS);
    expect(ingredients.map((i) => i.product_id)).toEqual(
      items.map((i) => i.product_id),
    );
  });

  it("пустой состав даёт пустые списки", () => {
    expect(toCalcIngredients([])).toEqual([]);
    expect(toCalcItems([])).toEqual([]);
  });
});
