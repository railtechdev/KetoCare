import { describe, expect, it } from "vitest";

import { itemsOf, mealNumbers, withDish, withoutItem } from "./dayPlan";
import type { Menu, MenuItem } from "./useMenu";

function item(overrides: Partial<MenuItem>): MenuItem {
  return {
    id: "item-1",
    menu_id: "menu-1",
    patient_id: "patient-1",
    meal_index: 1,
    recipe_id: "recipe-1",
    custom_dish_id: null,
    portion_factor: 1,
    eaten: false,
    title: "Омлет",
    ingredients: [],
    changed_since_saved: false,
    ...overrides,
  } as MenuItem;
}

function menu(items: MenuItem[]): Menu {
  return {
    id: "menu-1",
    patient_id: "patient-1",
    date: "2026-09-17",
    items,
    totals: null,
    engine_version: null,
    excluded_products: [],
    withdrawn_products: [],
  } as unknown as Menu;
}

/**
 * День сохраняется целиком, и сервер переиспользует позицию, совпавшую по приёму
 * пищи и блюду: только у такой сохраняются отметка «съедено» и ссылки записей
 * дневника еды. Значит цена ошибки здесь — не пропавшая строка в списке, а
 * стёртые клинические данные: семья добавила ужин в шесть вечера и потеряла
 * отметки о завтраке и обеде, а врач увидел день, в котором ребёнок будто
 * ничего не ел.
 */
describe("состав дня для сохранения", () => {
  it("переносит существующие позиции без единого искажения", () => {
    const day = menu([
      item({ id: "a", meal_index: 1, recipe_id: "r1", portion_factor: 1.5 }),
      item({
        id: "b",
        meal_index: 3,
        recipe_id: null,
        custom_dish_id: "d1",
        portion_factor: 0.25,
      }),
    ]);

    expect(itemsOf(day)).toEqual([
      {
        meal_index: 1,
        recipe_id: "r1",
        custom_dish_id: null,
        portion_factor: 1.5,
      },
      {
        meal_index: 3,
        recipe_id: null,
        custom_dish_id: "d1",
        portion_factor: 0.25,
      },
    ]);
  });

  it("добавление блюда не трогает уже стоящие позиции", () => {
    const day = menu([
      item({ id: "a", meal_index: 1, recipe_id: "r1", portion_factor: 2 }),
    ]);

    const next = withDish(itemsOf(day), { kind: "recipe", id: "r2" }, 2, 1);

    // Первая позиция обязана уехать байт в байт той же — иначе сервер сочтёт
    // её другой и заведёт заново с `eaten = false`.
    expect(next[0]).toEqual({
      meal_index: 1,
      recipe_id: "r1",
      custom_dish_id: null,
      portion_factor: 2,
    });
    expect(next).toHaveLength(2);
  });

  it("своё блюдо уходит в custom_dish_id, а не в recipe_id", () => {
    // Схема требует ровно одну из двух ссылок; перепутать их — значит сослаться
    // на чужую таблицу и получить отказ либо не то блюдо.
    const [added] = withDish([], { kind: "custom", id: "d7" }, 1, 1);

    expect(added).toEqual({
      meal_index: 1,
      recipe_id: null,
      custom_dish_id: "d7",
      portion_factor: 1,
    });
  });

  it("убирает позицию по её идентификатору, а не по блюду", () => {
    // Одно и то же блюдо законно стоит дважды в одном приёме — две порции
    // разной величины. Удаление «по блюду» сняло бы обе.
    const day = menu([
      item({ id: "a", meal_index: 1, recipe_id: "r1", portion_factor: 1 }),
      item({ id: "b", meal_index: 1, recipe_id: "r1", portion_factor: 0.5 }),
    ]);

    const next = withoutItem(day, "a");

    expect(next).toEqual([
      {
        meal_index: 1,
        recipe_id: "r1",
        custom_dish_id: null,
        portion_factor: 0.5,
      },
    ]);
  });

  it("день без меню — это пустой состав, а не отказ", () => {
    expect(itemsOf(null)).toEqual([]);
    expect(withoutItem(null, "нет такого")).toEqual([]);
  });
});

describe("приёмы пищи в дне", () => {
  it("столько, сколько назначил врач", () => {
    expect(mealNumbers(6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("без назначения приёмов не существует", () => {
    // Подставить один приём «чтобы работало» значило бы принять медицинское
    // решение за врача (ADR-0029).
    expect(mealNumbers(null)).toEqual([]);
    expect(mealNumbers(0)).toEqual([]);
  });
});
