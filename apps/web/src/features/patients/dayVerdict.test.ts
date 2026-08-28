import { describe, expect, it } from "vitest";

import { dayVerdict } from "./dayVerdict";

describe("dayVerdict", () => {
  it("без вердикта сервера сравнивать не с чем", () => {
    expect(dayVerdict(null)).toEqual({
      ratioOffTolerance: false,
      kcalBelowTarget: false,
      unavailable: true,
    });
    expect(dayVerdict(undefined).unavailable).toBe(true);
  });

  it("расхождение кетосоотношения — предупреждение в любой момент дня", () => {
    // Соотношение обязано держаться в каждом приёме пищи, поэтому его выход за
    // допуск верен и на половине дня.
    const verdict = dayVerdict({
      ratio_within_tolerance: false,
      kcal_within_tolerance: true,
    });

    expect(verdict.ratioOffTolerance).toBe(true);
    expect(verdict.kcalBelowTarget).toBe(false);
  });

  it("недобор калорий не выдаётся за расхождение", () => {
    // Сервер сравнивает набранное с СУТОЧНОЙ нормой, а признака «день
    // спланирован до конца» нет. Показать это предупреждением значит зажечь его
    // навсегда — и приучить не читать предупреждения вообще.
    const verdict = dayVerdict({
      ratio_within_tolerance: true,
      kcal_within_tolerance: false,
    });

    expect(verdict.ratioOffTolerance).toBe(false);
    expect(verdict.kcalBelowTarget).toBe(true);
  });

  it("день в допусках не даёт ни предупреждения, ни недобора", () => {
    expect(
      dayVerdict({ ratio_within_tolerance: true, kcal_within_tolerance: true }),
    ).toEqual({
      ratioOffTolerance: false,
      kcalBelowTarget: false,
      unavailable: false,
    });
  });
});
