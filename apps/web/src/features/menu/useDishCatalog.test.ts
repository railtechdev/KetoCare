import { describe, expect, it } from "vitest";

import { dishKey, itemDishKey } from "./useDishCatalog";

/**
 * Регрессия: главная искала название блюда по идентификатору ПОЗИЦИИ меню, а
 * словарь заполнен по ключу блюда (`recipe:<id>` / `custom:<id>`). Совпадений не
 * бывало никогда, и блок «Ближайший приём пищи» — тот, ради которого родитель
 * открывает кабинет чаще всего, — вместо названия всегда показывал «Блюдо».
 *
 * Тест закрепляет форму ключа: пока она едина у составителя словаря и у
 * читателей, расхождение невозможно.
 */
describe("ключ блюда в меню", () => {
  const RECIPE = "11111111-1111-4111-8111-111111111111";
  const CUSTOM = "22222222-2222-4222-8222-222222222222";
  const ITEM = "33333333-3333-4333-8333-333333333333";

  function item(patch: Record<string, unknown>) {
    return {
      id: ITEM,
      menu_id: "m1",
      meal_slot: "breakfast",
      recipe_id: null,
      custom_dish_id: null,
      portion_factor: 1,
      eaten: false,
      ...patch,
    } as Parameters<typeof itemDishKey>[0];
  }

  it("позиция с рецептом даёт ключ рецепта, а не позиции", () => {
    expect(itemDishKey(item({ recipe_id: RECIPE }))).toBe(
      dishKey("recipe", RECIPE),
    );
    expect(itemDishKey(item({ recipe_id: RECIPE }))).not.toBe(ITEM);
  });

  it("позиция со своим блюдом даёт ключ блюда", () => {
    expect(itemDishKey(item({ custom_dish_id: CUSTOM }))).toBe(
      dishKey("custom", CUSTOM),
    );
  });

  it("позиция без блюда ключа не имеет", () => {
    expect(itemDishKey(item({}))).toBeNull();
  });
});
