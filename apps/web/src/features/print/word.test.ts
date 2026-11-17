import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import calculatorRu from "../../locales/ru/calculator.json";
import doctorRu from "../../locales/ru/doctor.json";
import menuRu from "../../locales/ru/menu.json";
import type { WordBlock } from "../../lib/wordExport";
import type { MenuWeek } from "../menu/useWeek";
import type { Prescription } from "../doctor/types";
import { dishWordModel } from "./dishWord";
import { prescriptionWordSection } from "./prescriptionWord";
import { weekFileName, weekRangeLabel, weekWordModel } from "./weekWord";

i18n.addResourceBundle("ru", "menu", menuRu, true, true);
i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);
i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);
const t = i18n.t.bind(i18n);

function item(meal: number, title: string, instructions: string | null) {
  return {
    id: `i${meal}`,
    meal_index: meal,
    title,
    instructions,
    ingredients: [
      { product_id: "p1", name_ru: "Яйцо куриное", grams: 40 },
      { product_id: "p2", name_ru: "Сливки 36%", grams: 52.5 },
    ],
  };
}

const WEEK = {
  start: "2026-11-16",
  days: [
    {
      date: "2026-11-16",
      menu: {
        totals: { kcal: 1380, fat: 120, protein: 23, carbs: 17, ratio: 3 },
        items: [item(2, "Суп", null), item(1, "Омлет", "Взбить.\nЗапечь.")],
        excluded_products: [{ name_ru: "Арахис" }],
      },
    },
    { date: "2026-11-17", menu: null },
    {
      date: "2026-11-18",
      menu: {
        totals: { kcal: 1200, fat: 100, protein: 20, carbs: 15, ratio: null },
        items: [item(1, "Омлет", null)],
        excluded_products: [],
      },
    },
  ],
} as unknown as MenuWeek;

const textOf = (blocks: readonly WordBlock[]) =>
  blocks.flatMap((block) =>
    block.kind === "table"
      ? [...block.header, ...block.rows.flat()]
      : block.kind === "steps"
        ? [block.label, block.text]
        : [block.text],
  );

describe("week in Word — the same sheet as WeekPrint", () => {
  it("makes a section per day with dishes, meals in order", () => {
    const model = weekWordModel(t, WEEK, "Пациент");

    // Пустой день не выгружается.
    expect(model.sections).toHaveLength(2);
    expect(textOf(model.sections[0]!.blocks)).toEqual([
      "Меню: Пациент",
      "пн, 16 ноября 2026 г.",
      expect.stringMatching(
        /^3\.0 : 1 · Итого за день: 1\s380 ккал · жиры 120,0 г, белки 23,0 г, углеводы 17,0 г$/,
      ),
      "Внимание, исключено ребёнку: Арахис",
      "Приём 1. Омлет",
      "Продукт",
      "Вес",
      "Яйцо куриное",
      "40 г",
      "Сливки 36%",
      "52,5 г",
      "Приготовление",
      "Взбить.\nЗапечь.",
      "Приём 2. Суп",
      "Продукт",
      "Вес",
      "Яйцо куриное",
      "40 г",
      "Сливки 36%",
      "52,5 г",
    ]);
    // Без соотношения строка начинается с калорий.
    expect(textOf(model.sections[1]!.blocks)[2]).toMatch(/^Итого за день/);
  });

  it("names the file after the child and the week", () => {
    expect(weekFileName("Меню", "Пациент", WEEK.start)).toBe(
      "Меню — Пациент — 16–22.11.2026",
    );
    expect(weekRangeLabel("2026-11-30")).toBe("30.11–06.12.2026");
    expect(weekRangeLabel("2026-12-28")).toBe("28.12.2026–03.01.2027");
  });
});

describe("dish card in Word — the same as DishPrint", () => {
  it("has the composition, the numbers, the steps and the engine version", () => {
    const model = dishWordModel(t, {
      title: "Жареная курица",
      rows: [
        {
          product: { id: "p1", name: "Курица" } as never,
          grams: 19,
        },
      ],
      dish: {
        kcal: 277,
        fat_g: 26.5,
        protein_g: 5.4,
        carbs_g: 4.3,
        fiber_g: 0.3,
        net_carbs_g: 4,
        ratio: 3,
        engine_version: "1.12.0",
      },
      steps: "Обжарить.",
    });

    expect(model.sections).toHaveLength(1);
    expect(textOf(model.sections[0]!.blocks)).toEqual([
      "Жареная курица",
      "Продукт",
      "Вес",
      "Курица",
      "19 г",
      "3.0 : 1, 277 ккал",
      "Жиры 26,5 г, белки 5,4 г, углеводы 4,3 г",
      "Приготовление",
      "Обжарить.",
      "Версия расчёта: 1.12.0",
    ]);
  });
});

describe("prescription in Word — the same as PrescriptionSheet", () => {
  const ACTIVE = {
    ratio: 3,
    kcal_per_day: 1380,
    carbs_limit_g: 10,
    meals_per_day: 5,
    effective_from: "2026-11-12",
    fluid_ml_per_day: null,
    restrictions: null,
  } as unknown as Prescription;

  it("lists the values and the grams table per day and per meal", () => {
    const section = prescriptionWordSection(t, ACTIVE, "Пациент", {
      day: { fat_g: 133.5, protein_g: 23, net_carbs_g: 21.5, non_fat_g: 44.5 },
      meal: { fat_g: 26.7, protein_g: 4.6, net_carbs_g: 4.3, non_fat_g: 8.9 },
      dietary_unit_kcal: 31,
      engine_version: "1.12.0",
    });
    const table = section.blocks.find((block) => block.kind === "table");

    expect(textOf(section.blocks)[0]).toContain("Пациент");
    expect(table).toMatchObject({ numeric: [1, 2] });
    expect(table?.kind === "table" && table.rows[0]).toEqual([
      expect.any(String),
      "133,5 г",
      "26,7 г",
    ]);
  });

  it("leaves the table out while the grams are not known", () => {
    const section = prescriptionWordSection(t, ACTIVE, "Пациент", undefined);
    expect(section.blocks.some((block) => block.kind === "table")).toBe(false);
  });
});
