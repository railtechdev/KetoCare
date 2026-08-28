import { describe, expect, it } from "vitest";

import { formatOverviewDate, parseIsoDate } from "./date";

describe("parseIsoDate", () => {
  it("читает дату как местную полночь, а не как UTC", () => {
    const date = parseIsoDate("2026-08-28");

    // Именно локальные геттеры: при разборе через UTC в зонах западнее
    // Гринвича здесь оказалось бы 27-е число.
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(28);
  });

  it("не принимает строку с временем", () => {
    expect(parseIsoDate("2026-08-28T10:00:00Z")).toBeNull();
  });

  it("не принимает пустую строку", () => {
    expect(parseIsoDate("")).toBeNull();
  });
});

describe("formatOverviewDate", () => {
  it("подписывает дату по-русски", () => {
    expect(formatOverviewDate("2026-08-28")).toBe("28 августа 2026 г.");
  });

  it("возвращает null, если дата не разобрана", () => {
    expect(formatOverviewDate("не дата")).toBeNull();
  });
});
