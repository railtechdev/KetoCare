import { shoppingList } from "@ketocare/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import {
  SHOPPING_ROWS_PER_SHEET,
  ShoppingListSheet,
  shoppingPages,
} from "./ShoppingListSheet";
import type { MenuWeek } from "./useWeek";

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

function row(id: string, name: string, grams: number, counts = true) {
  return {
    product_id: id,
    name_ru: name,
    grams,
    counts_in_calculation: counts,
  };
}

const WEEK = {
  start: "2026-11-16",
  days: [
    {
      date: "2026-11-16",
      menu: {
        items: [
          {
            id: "a",
            ingredients: [
              row("egg", "Яйцо", 40),
              row("salt", "Соль", 0.5, false),
            ],
          },
          {
            id: "b",
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
      menu: { items: [{ id: "c", ingredients: [row("egg", "Яйцо", 40)] }] },
    },
    { date: "2026-11-18", menu: null },
  ],
} as unknown as MenuWeek;

describe("shopping list (ADR-0092)", () => {
  // Сложение по продукту — `shoppingList` кита, его тесты там же
  // (`packages/ui/src/lib/shoppingList.test.ts`). Здесь — что лист его
  // принимает в форме недели сервера.
  it("takes the server week as is", () => {
    const { lines, seasonings } = shoppingList(WEEK);

    expect(lines).toEqual([
      { productId: "cream", name: "Сливки 33%", grams: 52.5, days: 1 },
      { productId: "egg", name: "Яйцо", grams: 105, days: 2 },
    ]);
    expect(seasonings).toEqual(["Соль"]);
  });

  it("prints the weights, the days covered and the seasonings without grams", () => {
    const { lines, seasonings } = shoppingList(WEEK);
    render(
      <ShoppingListSheet
        lines={lines}
        seasonings={seasonings}
        rangeLabel="16–22.11.2026"
        days={2}
        first
        last
      />,
    );

    // Неделя собрана не вся: лист называет, сколько дней в нём сложено.
    expect(
      screen.getByText(
        "Неделя 16–22.11.2026, дней с меню: 2. Граммы сложены по этим дням.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("105 г")).toBeInTheDocument();
    expect(
      screen.getByText(/Приправы по вкусу/).parentElement,
    ).toHaveTextContent("Соль");
  });

  it("splits a long list into sheets, notes only on the last one", () => {
    const many = Array.from(
      { length: SHOPPING_ROWS_PER_SHEET + 3 },
      (_, i) => ({
        productId: `p${i}`,
        name: `Продукт ${i}`,
        grams: 10,
        days: 1,
      }),
    );
    const pages = shoppingPages(many);
    expect(pages.map((page) => page.length)).toEqual([
      SHOPPING_ROWS_PER_SHEET,
      3,
    ]);

    render(
      <ShoppingListSheet
        lines={pages[0]!}
        seasonings={["Соль"]}
        rangeLabel="16–22.11.2026"
        days={7}
        first
        last={false}
      />,
    );
    expect(screen.queryByText(/Приправы по вкусу/)).toBeNull();
  });
});
