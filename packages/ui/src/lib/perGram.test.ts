import { describe, expect, it } from "vitest";

import { formatPerGram, toPer100, toPerGram } from "./perGram";

describe("пищевая ценность на 1 г", () => {
  it("переводит туда и обратно без потерь при двух знаках на 100 г", () => {
    for (const per100 of [82.5, 0.7, 3.65, 748, 81.13, 0, 0.01, 99.99]) {
      expect(toPer100(toPerGram(per100))).toBe(per100);
    }
  });

  it("не даёт ошибок плавающей точки", () => {
    expect(toPerGram(82.5)).toBe(0.825);
    expect(toPer100(0.825)).toBe(82.5);
    expect(toPer100(0.0365)).toBe(3.65);
  });

  it("показывает все знаки и без хвостовых нулей", () => {
    expect(formatPerGram(82.5)).toBe("0,825");
    expect(formatPerGram(3.65)).toBe("0,0365");
    expect(formatPerGram(748)).toBe("7,48");
    expect(formatPerGram(0)).toBe("0");
  });
});
