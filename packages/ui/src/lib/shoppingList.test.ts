import { describe, expect, it } from "vitest";

import { daysWithMenu, shoppingList, type ShoppingDay } from "./shoppingList";

function row(id: string, name: string, grams: number, counts = true) {
  return {
    product_id: id,
    name_ru: name,
    grams,
    counts_in_calculation: counts,
  };
}

const DAYS: ShoppingDay[] = [
  {
    date: "2026-11-16",
    menu: {
      items: [
        {
          ingredients: [
            row("egg", "Яйцо", 40),
            row("salt", "Соль", 0.5, false),
          ],
        },
        {
          ingredients: [
            row("cream", "Сливки 33%", 52.5),
            row("egg", "Яйцо", 25),
          ],
        },
      ],
    },
  },
  {
    date: "2026-11-17",
    menu: { items: [{ ingredients: [row("egg", "Яйцо", 40)] }] },
  },
  { date: "2026-11-18", menu: null },
  { date: "2026-11-19", menu: { items: [] } },
];

describe("shoppingList", () => {
  it("складывает граммы по продукту и считает дни", () => {
    const { lines, seasonings } = shoppingList({ days: DAYS });

    expect(lines).toEqual([
      { productId: "cream", name: "Сливки 33%", grams: 52.5, days: 1 },
      { productId: "egg", name: "Яйцо", grams: 105, days: 2 },
    ]);
    // Приправа — без граммов: её не взвешивают (ADR-0054).
    expect(seasonings).toEqual(["Соль"]);
  });

  it("пустые дни ничего не добавляют", () => {
    expect(shoppingList({ days: [] })).toEqual({ lines: [], seasonings: [] });
    expect(shoppingList({ days: null })).toEqual({
      lines: [],
      seasonings: [],
    });
  });
});

describe("daysWithMenu", () => {
  it("день без меню и день с пустым меню в счёт не идут", () => {
    expect(daysWithMenu(DAYS).map((day) => day.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
    ]);
  });
});
