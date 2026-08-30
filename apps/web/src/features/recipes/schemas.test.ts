// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  recipeFormSchema,
  toRecipeBody,
  toRecipeFormValues,
  type RecipeFormValues,
} from "./schemas";
import type { Recipe } from "./types";

const RECIPE: Recipe = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Запеканка",
  category: "breakfast",
  photo_path: null,
  yield_g: 320.5,
  servings: 2,
  instructions: "Смешать и запечь.",
  status: "published",
  computed: { kcal: 900, fat: 80, protein: 20, carbs: 5, fiber: 1, ratio: 3.2 },
  // Рецепт на две порции: количества делятся, соотношение — нет.
  per_portion: {
    kcal: 450,
    fat: 40,
    protein: 10,
    carbs: 2.5,
    fiber: 0.5,
    ratio: 3.2,
  },
  engine_version: "1.0.0",
  author_id: "22222222-2222-2222-2222-222222222222",
  ingredients: [
    { product_id: "aaa", grams: 100, position: 0 },
    { product_id: "bbb", grams: 20.5, position: 1 },
  ],
  created_at: "2026-01-01T10:00:00Z",
};

const VALUES: RecipeFormValues = {
  title: "  Запеканка  ",
  category: "breakfast",
  photoPath: "  ",
  yieldG: 320.5,
  servings: 2,
  instructions: "  Смешать и запечь.  ",
  ingredients: [
    { productId: "aaa", name: "Творог", grams: 100 },
    { productId: "bbb", name: "Масло", grams: 20.5 },
  ],
};

describe("рецепт с сервера в значения формы", () => {
  it("состав получает названия продуктов по идентификаторам", () => {
    const values = toRecipeFormValues(
      RECIPE,
      { aaa: "Творог", bbb: "Масло" },
      "неизвестно",
    );

    expect(values.ingredients).toEqual([
      { productId: "aaa", name: "Творог", grams: 100 },
      { productId: "bbb", name: "Масло", grams: 20.5 },
    ]);
  });

  it("продукт без названия подписывается запасным текстом, а не идентификатором", () => {
    // Идентификатор в строке состава не говорит диетологу ничего, а сохранить
    // рецепт с непонятной строкой он всё равно сможет.
    const values = toRecipeFormValues(RECIPE, { aaa: "Творог" }, "неизвестно");
    expect(values.ingredients[1]?.name).toBe("неизвестно");
  });

  it("отсутствующее фото становится пустым полем", () => {
    expect(toRecipeFormValues(RECIPE, {}, "неизвестно").photoPath).toBe("");
  });
});

describe("значения формы в тело запроса", () => {
  it("состав отправляется идентификаторами и массами, без пищевой ценности", () => {
    // Показатели считает сервер по данным справочника: приняв их от клиента,
    // API дал бы «посчитать» рецепт по выдуманным макронутриентам.
    expect(toRecipeBody(VALUES).ingredients).toEqual([
      { product_id: "aaa", grams: 100 },
      { product_id: "bbb", grams: 20.5 },
    ]);
  });

  it("пустое фото уходит как null, а не пустой строкой", () => {
    expect(toRecipeBody(VALUES).photo_path).toBeNull();
  });

  it("название и инструкция сохраняются без обрамляющих пробелов", () => {
    const body = toRecipeBody(VALUES);
    expect(body.title).toBe("Запеканка");
    expect(body.instructions).toBe("Смешать и запечь.");
  });
});

describe("схема формы", () => {
  it("рецепт без состава не проходит: считать показатели не по чему", () => {
    const result = recipeFormSchema.safeParse({ ...VALUES, ingredients: [] });
    expect(result.success).toBe(false);
  });

  it("нулевые масса, выход и число порций отклоняются", () => {
    expect(recipeFormSchema.safeParse({ ...VALUES, yieldG: 0 }).success).toBe(
      false,
    );
    expect(recipeFormSchema.safeParse({ ...VALUES, servings: 0 }).success).toBe(
      false,
    );
    expect(
      recipeFormSchema.safeParse({
        ...VALUES,
        ingredients: [{ productId: "aaa", name: "Творог", grams: 0 }],
      }).success,
    ).toBe(false);
  });

  it("дробное число порций отклоняется", () => {
    expect(
      recipeFormSchema.safeParse({ ...VALUES, servings: 1.5 }).success,
    ).toBe(false);
  });

  it("заполненная форма проходит проверку", () => {
    expect(recipeFormSchema.safeParse(VALUES).success).toBe(true);
  });
});
