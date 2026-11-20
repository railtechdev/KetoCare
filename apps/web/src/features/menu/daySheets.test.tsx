import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DishCard } from "../../components/print/DishCard";
import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { daySheets, DayOverviewSheet } from "./daySheets";
import { menuDishCard, type WeekDay } from "./dayPrintModel";

i18n.addResourceBundle("ru", "menu", menuRu, true, true);
const t = i18n.t.bind(i18n);

function item(meal: number, title: string, instructions: string | null) {
  return {
    id: `i${meal}`,
    meal_index: meal,
    title,
    instructions,
    ingredients: [
      {
        product_id: "p1",
        name_ru: "Яйцо куриное",
        grams: 40,
        counts_in_calculation: true,
      },
      {
        product_id: "p2",
        name_ru: "Сливки 36%",
        grams: 52,
        counts_in_calculation: true,
      },
      {
        product_id: "p3",
        name_ru: "Соль",
        grams: 1,
        counts_in_calculation: false,
      },
    ],
  };
}

const DAY = {
  date: "2026-11-16",
  menu: {
    totals: { kcal: 1295, fat: 120, protein: 20.6, carbs: 14.1, ratio: 4 },
    prescription: {
      ratio: 4,
      kcal_per_day: 1300,
      protein_g: 20,
      carbs_limit_g: 15,
    },
    items: [item(2, "Суп", null), item(1, "Омлет", "Взбить.\nЗапечь.")],
    excluded_products: [{ name_ru: "Арахис" }],
  },
} as unknown as WeekDay;

describe("day of the menu on paper (ADR-0092)", () => {
  it("puts the day's numbers next to the day's prescription", () => {
    render(<DayOverviewSheet day={DAY} />);

    expect(screen.getByText(/1\s295 ккал/)).toBeInTheDocument();
    expect(screen.getByText(/из 1\s300/)).toBeInTheDocument();
    expect(screen.getByText("назначено 4.0 : 1")).toBeInTheDocument();
    expect(screen.getByText("не меньше 20,0")).toBeInTheDocument();
    expect(screen.getByText("не больше 15,0")).toBeInTheDocument();
    expect(screen.getByText("Арахис")).toBeInTheDocument();
  });

  it("lists the meals in order with their composition, without seasonings", () => {
    render(<DayOverviewSheet day={DAY} />);

    const meals = screen.getAllByText(/^Приём \d$/);
    expect(meals.map((node) => node.textContent)).toEqual([
      "Приём 1",
      "Приём 2",
    ]);
    expect(
      screen.getAllByText("Яйцо куриное 40 г · Сливки 36% 52 г"),
    ).toHaveLength(2);
  });

  it("gives every dish its own card after the overview", () => {
    const sheets = daySheets(t, DAY, "Пациент");

    expect(sheets.map((sheet) => sheet.code)).toEqual([
      "KC-WEEK-1",
      "KC-DISH-1",
      "KC-DISH-1",
    ]);
    expect(sheets[1]?.aside).toBe("Пациент · пн, 16 ноября 2026 г. · приём 1");
  });

  it("prints a card with tick boxes, seasonings apart and numbered steps", () => {
    const card = menuDishCard(t, DAY, DAY.menu!.items[1]!);
    render(<DishCard {...card} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Омлет" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("Яйцо куриное")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("40 г")).toBeInTheDocument();
    expect(
      screen.getByText("Соль — по вкусу, в расчёт не входят"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("leaves cooking out when the dish has no steps", () => {
    render(<DishCard {...menuDishCard(t, DAY, DAY.menu!.items[0]!)} />);
    expect(screen.queryByText("Приготовление")).toBeNull();
  });
});
