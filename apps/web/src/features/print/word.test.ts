import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import calculatorRu from "../../locales/ru/calculator.json";
import doctorRu from "../../locales/ru/doctor.json";
import menuRu from "../../locales/ru/menu.json";
import {
  buildWordDocument,
  wordFrame,
  type WordBlock,
} from "../../lib/wordExport";
import commonRu from "../../locales/ru/common.json";
import type { MenuWeek } from "../menu/useWeek";
import type { Prescription } from "../doctor/types";
import { dishWordModel } from "./dishWord";
import { prescriptionWordSection } from "./prescriptionWord";
import { weekFileName, weekRangeLabel, weekWordModel } from "./weekWord";

i18n.addResourceBundle("ru", "menu", menuRu, true, true);
i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);
i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);
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

describe("week in Word — the same sheets as the printed week", () => {
  it("makes a day overview and a card per dish, meals in order", () => {
    const model = weekWordModel(t, WEEK, "Пациент");

    // День 16-го: обзор и две карточки; 17-е пусто и не выгружается; 18-е —
    // обзор и одна карточка; последним — «Что взвесить за неделю», как на бумаге.
    expect(model.sections).toHaveLength(6);
    const shopping = textOf(model.sections[5]!.blocks);
    expect(shopping[0]).toBe("Что взвесить за неделю");
    expect(shopping).toContain(
      "Неделя 16–22.11.2026, дней с меню: 2. Граммы сложены по этим дням.",
    );
    // Яйцо: 40 г в трёх позициях за два дня.
    expect(shopping).toEqual(expect.arrayContaining(["Яйцо куриное", "120 г"]));
    const overview = textOf(model.sections[0]!.blocks);
    expect(overview.slice(0, 2)).toEqual([
      "Меню: Пациент",
      "пн, 16 ноября 2026 г.",
    ]);
    expect(overview).toContain("3.0 : 1");
    expect(overview).toContain("Исключено ребёнку: Арахис");
    expect(overview).toContain("Омлет: Яйцо куриное 40 г · Сливки 36% 52,5 г");
    expect(overview.indexOf("Приём 1")).toBeLessThan(
      overview.indexOf("Приём 2"),
    );

    const card = textOf(model.sections[1]!.blocks);
    expect(card.slice(0, 2)).toEqual([
      "Приём 1 · пн, 16 ноября 2026 г.",
      "Омлет",
    ]);
    expect(card).toEqual(
      expect.arrayContaining([
        "Взвешено",
        "☐",
        "52,5 г",
        "Приготовление",
        // Шаги пронумерованы так же, как на бумаге.
        "1. Взбить.\n2. Запечь.",
      ]),
    );
    expect(textOf(model.sections[2]!.blocks)[1]).toBe("Суп");
    // Без шагов «Приготовления» нет вовсе.
    expect(textOf(model.sections[2]!.blocks)).not.toContain("Приготовление");
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
    const text = textOf(model.sections[0]!.blocks);
    expect(text[0]).toBe("Жареная курица");
    expect(text).toEqual(
      expect.arrayContaining([
        "3.0 : 1",
        "26,5 · 5,4 · 4,3 г",
        "Курица",
        "19 г",
        "Приготовление",
        "Обжарить.",
      ]),
    );
    expect(text.at(-1)).toBe("Версия расчёта: 1.12.0");
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
    const section = prescriptionWordSection(
      t,
      ACTIVE,
      {
        day: {
          fat_g: 133.5,
          protein_g: 23,
          net_carbs_g: 21.5,
          non_fat_g: 44.5,
        },
        meal: { fat_g: 26.7, protein_g: 4.6, net_carbs_g: 4.3, non_fat_g: 8.9 },
        dietary_unit_kcal: 31,
        engine_version: "1.12.0",
      },
      ["Арахис"],
    );
    const tables = section.blocks.filter((block) => block.kind === "table");
    const grams = tables[1];

    expect(textOf(section.blocks)[0]).toBe("Назначение на кетогенную диету");
    expect(grams).toMatchObject({ numeric: [1, 2, 3] });
    expect(grams?.kind === "table" && grams.rows).toEqual([
      ["Один приём", "26,7 г", "4,6 г", "4,3 г"],
      ["За день", "133,5 г", "не меньше 23,0 г", "21,5 г"],
    ]);
    expect(textOf(section.blocks)).toContain("Исключено: Арахис");
  });

  it("leaves the table out while the grams are not known", () => {
    const section = prescriptionWordSection(t, ACTIVE, undefined);
    // Остаётся только таблица чисел назначения.
    expect(
      section.blocks.filter((block) => block.kind === "table"),
    ).toHaveLength(1);
  });
});

describe("Word frame — the same header and footer as the printed sheet (ADR-0092)", () => {
  const FRAME = {
    shortName: "ДНЦ «Образец»",
    logoBlob: undefined,
    familyPhone: "+998 71 000-00-00",
    author: "Иванова Анна Петровна, диетолог",
    generatedAt: "20.11.2026, 14:05",
  };

  it("names the clinic, the sheet, who made it and the family phone", () => {
    const frame = wordFrame(t, FRAME, {
      title: "Карточка блюда",
      aside: "Мария О.",
      code: "KC-DISH-1",
    });

    expect(frame.header).toBe("ДНЦ «Образец» · Карточка блюда");
    expect(frame.aside).toBe("Мария О.");
    expect(frame.footer).toBe(
      "Вопросы по диете: +998 71 000-00-00 · сформировал(а) Иванова Анна Петровна, диетолог, 20.11.2026, 14:05 · KetoCare · KC-DISH-1",
    );
    expect([frame.pageWord, frame.ofWord]).toEqual(["Стр.", "из"]);
  });

  it("leaves the family phone off a sheet for the staff", () => {
    const frame = wordFrame(t, FRAME, {
      title: "Справочник",
      code: "KC-LIST-1",
      staff: true,
    });

    expect(frame.footer).not.toContain("+998");
  });

  it("builds a file with the frame", async () => {
    const blob = await buildWordDocument({
      title: "Карточка",
      sections: [{ blocks: [{ kind: "heading", text: "Омлет", level: 1 }] }],
      frame: wordFrame(t, FRAME, {
        title: "Карточка блюда",
        code: "KC-DISH-1",
      }),
    });

    expect(blob.size).toBeGreaterThan(1000);
  });
});
