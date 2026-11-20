import { afterEach, describe, expect, it } from "vitest";

import { chatDayLabel, withChatDays } from "./chatDays";
import { setFormatLanguage } from "./format";

const WORDS = { today: "Сегодня", yesterday: "Вчера" };
const NOW = new Date(2026, 10, 20, 10, 0);

afterEach(() => {
  setFormatLanguage("ru");
});

describe("chatDayLabel", () => {
  it("сегодня и вчера — словами, по местной полуночи", () => {
    expect(chatDayLabel(new Date(2026, 10, 20, 0, 5), NOW, WORDS)).toBe(
      "Сегодня",
    );
    expect(chatDayLabel(new Date(2026, 10, 19, 23, 55), NOW, WORDS)).toBe(
      "Вчера",
    );
  });

  it("раньше — число и месяц, год только не нынешний", () => {
    expect(chatDayLabel(new Date(2026, 10, 13, 12), NOW, WORDS)).toBe(
      "13 ноября",
    );
    expect(chatDayLabel(new Date(2025, 10, 13, 12), NOW, WORDS)).toMatch(
      /13 ноября 2025/,
    );
  });

  it("месяц — на языке экрана", () => {
    setFormatLanguage("uz");
    expect(chatDayLabel(new Date(2026, 10, 13, 12), NOW, WORDS)).toBe(
      "13-noyabr",
    );
    expect(chatDayLabel(new Date(2025, 10, 13, 12), NOW, WORDS)).toBe(
      "2025-yil 13-noyabr",
    );
  });
});

describe("withChatDays", () => {
  it("подпись дня — только над первой репликой дня", () => {
    const items = [
      new Date(2026, 10, 13, 9),
      new Date(2026, 10, 13, 9, 1),
      new Date(2026, 10, 20, 8),
      new Date(2026, 10, 20, 8, 1),
    ];
    expect(
      withChatDays(items, (item) => item, NOW, WORDS).map((row) => row.day),
    ).toEqual(["13 ноября", null, "Сегодня", null]);
  });
});
