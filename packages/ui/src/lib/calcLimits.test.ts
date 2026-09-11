// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CALC_GRAMS_MAX, exceedsCalcGrams } from "./calcLimits";

describe("предел массы позиции в расчёте", () => {
  it("совпадает с пределом сервера", () => {
    // Значение сверяет со схемой API и тест на стороне сервера; здесь оно
    // закреплено, чтобы правка числа в ките не прошла молча.
    expect(CALC_GRAMS_MAX).toBe(5000);
  });

  it("сам предел допустим, всё тяжелее — нет", () => {
    expect(exceedsCalcGrams(5000)).toBe(false);
    expect(exceedsCalcGrams(5000.1)).toBe(true);
    expect(exceedsCalcGrams(0)).toBe(false);
  });
});
