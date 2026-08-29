import { describe, expect, it } from "vitest";

import { ageInMonths, formatIsoDate, formatTimestamp } from "./dates";

describe("ageInMonths", () => {
  it("считает полные месяцы", () => {
    expect(ageInMonths("2020-01-15", new Date(2026, 7, 28))).toBe(79);
  });

  it("не засчитывает месяц до наступления числа рождения", () => {
    expect(ageInMonths("2026-01-30", new Date(2026, 1, 28))).toBe(0);
    expect(ageInMonths("2026-01-30", new Date(2026, 2, 30))).toBe(2);
  });

  it("в день рождения возраст ноль", () => {
    expect(ageInMonths("2026-08-28", new Date(2026, 7, 28))).toBe(0);
  });

  it("даёт null для даты в будущем и для нечитаемой строки", () => {
    expect(ageInMonths("2027-01-01", new Date(2026, 7, 28))).toBeNull();
    expect(ageInMonths("2026-02-31", new Date(2026, 7, 28))).toBeNull();
    expect(ageInMonths("не дата", new Date(2026, 7, 28))).toBeNull();
  });
});

describe("formatIsoDate", () => {
  it("не съезжает на сутки назад из-за разбора как UTC", () => {
    expect(formatIsoDate("2026-08-28")).toBe("28.08.2026");
  });

  it("даёт null для нечитаемой строки", () => {
    expect(formatIsoDate("2026-13-01")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("даёт null для нечитаемой строки", () => {
    expect(formatTimestamp("нет")).toBeNull();
  });
});
