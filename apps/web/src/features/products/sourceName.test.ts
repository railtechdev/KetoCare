import { describe, expect, it } from "vitest";

import { shortSourceName } from "./sourceName";

describe("короткое имя источника в колонке справочника", () => {
  it.each([
    ["USDA FoodData Central SR Legacy", "USDA FoodData Central"],
    ["Лечебное питание, Нестеренко В. И. (2011)", "Лечебное питание"],
    ["Таблицы Минздрава (2011)", "Таблицы Минздрава"],
    ["Своё", "Своё"],
  ])("%s → %s", (source, expected) => {
    expect(shortSourceName(source)).toBe(expected);
  });

  it("строка, собранная из нескольких источников, называет каждый коротко", () => {
    expect(
      shortSourceName(
        "Слияние: Лечебное питание, Нестеренко В. И. (2011) + USDA FoodData Central SR Legacy",
      ),
    ).toBe("Лечебное питание + USDA FoodData Central");
  });

  it("пустое имя не превращается в пустую ячейку с подсказкой ни о чём", () => {
    expect(shortSourceName("  ")).toBe("");
  });
});
