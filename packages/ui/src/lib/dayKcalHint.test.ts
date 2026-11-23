import { describe, expect, it } from "vitest";

import { dayKcalHint, kcalRoundingSlack } from "./dayKcalHint";
import { mealTargetsFrom } from "./mealTargets";

describe("kcalRoundingSlack", () => {
  it("is one kilocalorie per two meals, rounded up", () => {
    expect(kcalRoundingSlack(3)).toBe(2);
    expect(kcalRoundingSlack(4)).toBe(2);
    expect(kcalRoundingSlack(5)).toBe(3);
    expect(kcalRoundingSlack(6)).toBe(3);
    expect(kcalRoundingSlack(10)).toBe(5);
  });

  it("forgives one kilocalorie when the number of meals is unknown", () => {
    expect(kcalRoundingSlack(null)).toBe(1);
    expect(kcalRoundingSlack(undefined)).toBe(1);
    expect(kcalRoundingSlack(0)).toBe(1);
    expect(kcalRoundingSlack(Number.NaN)).toBe(1);
  });
});

describe("dayKcalHint", () => {
  it("reads a day one kilocalorie off as reached, on either side", () => {
    expect(dayKcalHint(1199, 1200, 4)).toEqual({ kind: "reached" });
    expect(dayKcalHint(1201, 1200, 4)).toEqual({ kind: "reached" });
    expect(dayKcalHint(1200, 1200, 4)).toEqual({ kind: "reached" });
  });

  it("goes by whole kilocalories, as the bar prints them", () => {
    // 1 197,6 is printed «1 198»: two off at four meals — still rounding.
    expect(dayKcalHint(1197.6, 1200, 4)).toEqual({ kind: "reached" });
    // 1 197,4 is printed «1 197»: three off — «добавьте ещё 3».
    expect(dayKcalHint(1197.4, 1200, 4)).toEqual({ kind: "left", kcal: 3 });
  });

  it("still says how much to add or how much is over beyond the rounding", () => {
    expect(dayKcalHint(850, 1200, 4)).toEqual({ kind: "left", kcal: 350 });
    expect(dayKcalHint(1203, 1200, 4)).toEqual({ kind: "over", kcal: 3 });
    expect(dayKcalHint(1260, 1200, 6)).toEqual({ kind: "over", kcal: 60 });
  });

  it("without the number of meals forgives one kilocalorie only", () => {
    expect(dayKcalHint(1199, 1200)).toEqual({ kind: "reached" });
    expect(dayKcalHint(1198, 1200)).toEqual({ kind: "left", kcal: 2 });
    expect(dayKcalHint(1202, 1200, null)).toEqual({ kind: "over", kcal: 2 });
  });

  it("covers every day built exactly to the rounded meal goals", () => {
    // The slack is the rounding of the meal goal and nothing more: a day
    // where each meal hits its goal to the kilocalorie is always «reached».
    for (let meals = 1; meals <= 10; meals += 1) {
      for (let day = 600; day <= 2500; day += 1) {
        const goal = mealTargetsFrom({
          ratio: 4,
          kcal_per_day: day,
          meals_per_day: meals,
        });
        expect(goal).not.toBeNull();
        expect(dayKcalHint((goal?.kcal ?? 0) * meals, day, meals)).toEqual({
          kind: "reached",
        });
      }
    }
  });

  it("stays far inside the 5 % calorie tolerance of the day", () => {
    // The smallest daily calories a prescription may carry is well above
    // 100 kcal per meal; even there the slack is a fraction of 5 %.
    for (let meals = 1; meals <= 10; meals += 1) {
      expect(kcalRoundingSlack(meals)).toBeLessThan(0.05 * 100 * meals);
    }
  });
});
