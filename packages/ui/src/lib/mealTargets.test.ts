import { describe, expect, it } from "vitest";

import { mealTargetsFrom } from "./mealTargets";

describe("цель приёма из назначения", () => {
  it("делит суточную норму на число приёмов", () => {
    expect(
      mealTargetsFrom({ ratio: 3.5, kcal_per_day: 1200, meals_per_day: 4 }),
    ).toEqual({ ratio: 3.5, kcal: 300 });
  });

  it("округляет до целого: граммы взвешивают, а не доли килокалории", () => {
    expect(
      mealTargetsFrom({ ratio: 4, kcal_per_day: 1150, meals_per_day: 4 }),
    ).toEqual({ ratio: 4, kcal: 288 });
  });

  it("без назначения цели нет — её не выдумывают", () => {
    expect(mealTargetsFrom(null)).toBeNull();
    expect(mealTargetsFrom(undefined)).toBeNull();
  });

  it("ноль приёмов — это «цели нет», а не деление на ноль", () => {
    expect(
      mealTargetsFrom({ ratio: 3, kcal_per_day: 1000, meals_per_day: 0 }),
    ).toBeNull();
  });
});
