import { describe, expect, it } from "vitest";

import { firstAndLast, periodStart, seizuresByWeek } from "./lastDays";

describe("блок «За 30 дней»", () => {
  it("период — 30 дней включая сегодня", () => {
    expect(periodStart("2026-11-12")).toBe("2026-10-14");
    // Через переход на зимнее время сутки не теряются.
    expect(periodStart("2026-11-01", 8)).toBe("2026-10-25");
  });

  it("приступы — по четырём полным неделям назад от сегодня, новые первыми", () => {
    const weeks = seizuresByWeek(
      {
        "2026-11-12": 2,
        "2026-11-06": 1,
        "2026-11-05": 3,
        "2026-10-16": 4,
        // Старше четырёх недель — в недели не входит.
        "2026-10-14": 9,
      },
      "2026-11-12",
    );

    expect(weeks).toEqual([
      { from: "2026-11-06", to: "2026-11-12", count: 3 },
      { from: "2026-10-30", to: "2026-11-05", count: 3 },
      { from: "2026-10-23", to: "2026-10-29", count: 0 },
      { from: "2026-10-16", to: "2026-10-22", count: 4 },
    ]);
  });

  it("первый и последний замер — по времени, а не по порядку ответа", () => {
    const ends = firstAndLast([
      { at: "2026-11-05T08:00:00Z", value: 2 },
      { at: "2026-11-01T08:00:00Z", value: 1 },
      { at: "2026-11-09T08:00:00Z", value: 3 },
    ]);

    expect(ends?.first.value).toBe(1);
    expect(ends?.last.value).toBe(3);
    expect(firstAndLast([])).toBeNull();
  });
});
