import { describe, expect, it } from "vitest";

import {
  menuKey,
  menusKey,
  toWriteItem,
  toWriteItems,
  type MenuItemRead,
} from "./useMenu";

const item = (over: Partial<MenuItemRead>): MenuItemRead => ({
  id: "item-1",
  menu_id: "menu-1",
  patient_id: "patient-1",
  meal_slot: "breakfast",
  recipe_id: null,
  custom_dish_id: null,
  portion_factor: 1,
  eaten: false,
  has_snapshot: true,
  changed_since_saved: false,
  ...over,
});

describe("toWriteItem", () => {
  it("рецепт заполняет только recipe_id", () => {
    expect(
      toWriteItem({
        slot: "lunch",
        kind: "recipe",
        id: "recipe-1",
        portionFactor: 1.5,
      }),
    ).toEqual({
      meal_slot: "lunch",
      recipe_id: "recipe-1",
      custom_dish_id: null,
      portion_factor: 1.5,
    });
  });

  it("своё блюдо заполняет только custom_dish_id", () => {
    expect(
      toWriteItem({
        slot: "snack",
        kind: "custom",
        id: "dish-1",
        portionFactor: 0.5,
      }),
    ).toEqual({
      meal_slot: "snack",
      recipe_id: null,
      custom_dish_id: "dish-1",
      portion_factor: 0.5,
    });
  });
});

describe("toWriteItems", () => {
  it("оставляет только поля записи", () => {
    // Схема записи запрещает лишние поля (extra=forbid), поэтому id позиции,
    // menu_id и отметка «съедено» в тело PUT попадать не должны.
    expect(
      toWriteItems([
        item({ id: "a", recipe_id: "recipe-1", eaten: true }),
        item({ id: "b", meal_slot: "dinner", custom_dish_id: "dish-1" }),
      ]),
    ).toEqual([
      {
        meal_slot: "breakfast",
        recipe_id: "recipe-1",
        custom_dish_id: null,
        portion_factor: 1,
      },
      {
        meal_slot: "dinner",
        recipe_id: null,
        custom_dish_id: "dish-1",
        portion_factor: 1,
      },
    ]);
  });

  it("день без позиций даёт пустой состав", () => {
    expect(toWriteItems(undefined)).toEqual([]);
  });
});

describe("ключи запросов", () => {
  it("день лежит под ключом пациента", () => {
    // Инвалидация по menusKey обязана задевать конкретный день, иначе после
    // сохранения меню на экране осталась бы прежняя выдача.
    const day = menuKey("patient-1", "2026-08-28");
    expect(day.slice(0, 3)).toEqual([...menusKey("patient-1")]);
  });
});
