import { describe, expect, it } from "vitest";

import {
  formatPortionFactor,
  isIsoDate,
  shiftIsoDate,
  toIsoDate,
} from "./dates";

describe("dates", () => {
  it("форматирует дату по локальному календарю", () => {
    expect(toIsoDate(new Date(2026, 7, 28))).toBe("2026-08-28");
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("сдвиг переходит через границы месяца и года", () => {
    expect(shiftIsoDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("сдвиг не зависит от часового пояса", () => {
    // Полночь по местному времени: сдвиг на сутки обязан дать соседнюю дату
    // календаря, а не «минус 24 часа», иначе в сутки перевода часов день
    // повторился бы или пропал.
    const start = toIsoDate(new Date(2026, 9, 25));
    expect(shiftIsoDate(shiftIsoDate(start, 1), -1)).toBe(start);
  });

  it("несуществующая дата не считается корректной", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-8-28")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate("2026-08-28")).toBe(true);
  });

  it("множитель порции показывается в русском формате", () => {
    expect(formatPortionFactor(1)).toBe("1");
    expect(formatPortionFactor(0.5)).toBe("0,5");
  });
});
