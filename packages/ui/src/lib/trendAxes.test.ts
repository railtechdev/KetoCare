import { describe, expect, it } from "vitest";

import { dayAxis, startOfLocalDay, valueDomain } from "./trendAxes";

describe("ось значений", () => {
  it("единственное значение не ложится на край", () => {
    // Верх оси был равен значению, и точка срезалась наполовину.
    const [lower, upper] = valueDomain([2.7]);
    expect(upper).toBeGreaterThan(2.7);
    expect(lower).toBeLessThan(2.7);
    expect(lower).toBeGreaterThanOrEqual(0);
  });

  it("запас — доля размаха, и ниже нуля ось не уходит", () => {
    expect(valueDomain([0.2, 2.2])).toEqual([0, 2.5]);
    expect(valueDomain([18, 20])).toEqual([17.7, 20.3]);
  });
});

describe("ось дней", () => {
  it("два замера одного дня — одна подпись, а не «07.10 07.10»", () => {
    const morning = new Date(2026, 9, 7, 8, 0).getTime();
    const evening = new Date(2026, 9, 7, 21, 0).getTime();

    const axis = dayAxis([morning, evening]);

    expect(axis.ticks).toEqual([startOfLocalDay(morning)]);
    expect(axis.domain[0]).toBeLessThanOrEqual(morning);
    expect(axis.domain[1]).toBeGreaterThan(evening);
  });

  it("месяц — не больше шести подписей, каждая на своём дне", () => {
    const first = new Date(2026, 8, 7, 9, 0).getTime();
    const last = new Date(2026, 9, 6, 9, 0).getTime();

    const { ticks } = dayAxis([first, last]);

    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(
      new Set(ticks.map((tick) => new Date(tick).toDateString())).size,
    ).toBe(ticks.length);
    for (const tick of ticks) expect(startOfLocalDay(tick)).toBe(tick);
  });
});
