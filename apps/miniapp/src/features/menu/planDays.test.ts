import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import {
  MENU_DAYS,
  PLAN_DAYS,
  clampMenuDay,
  copyLabelKey,
  dayName,
  dayStripLabel,
  menuDatesOf,
} from "./planDays";

const t = i18n.t.bind(i18n);
// Суббота, 21 ноября 2026 года, полдень.
const NOW = new Date(2026, 10, 21, 12);

describe("дни приложения (Р3 аудита Mini App)", () => {
  it("меню — вчера, сегодня и пять дней вперёд; план — без вчера", () => {
    expect(MENU_DAYS).toEqual([-1, 0, 1, 2, 3, 4, 5]);
    expect(PLAN_DAYS).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("три ближних дня — словом, дальше — день недели и число", () => {
    expect(MENU_DAYS.map((offset) => dayStripLabel(offset, t, NOW))).toEqual([
      "Вчера",
      "Сегодня",
      "Завтра",
      "пн 23",
      "вт 24",
      "ср 25",
      "чт 26",
    ]);
  });

  it("в предложении дальний день — полной датой", () => {
    expect(dayName(1, t, NOW)).toBe("Завтра");
    expect(dayName(3, t, NOW)).toBe("вторник, 24 ноября");
  });

  it("«Как вчера» у трёх ближних — прежними словами, дальше — обобщённо", () => {
    expect(MENU_DAYS.map((offset) => t(copyLabelKey(offset)))).toEqual([
      "Как позавчера",
      "Как вчера",
      "Как сегодня",
      "Как в предыдущий день",
      "Как в предыдущий день",
      "Как в предыдущий день",
      "Как в предыдущий день",
    ]);
  });

  it("сдвиг вне полосы открывает сегодня", () => {
    expect(clampMenuDay(5)).toBe(5);
    expect(clampMenuDay(-1)).toBe(-1);
    expect(clampMenuDay(6)).toBe(0);
    expect(clampMenuDay(-2)).toBe(0);
    expect(clampMenuDay(undefined)).toBe(0);
  });

  it("точка — только у дня с непустым меню", () => {
    expect(
      menuDatesOf([
        { date: "2026-11-21", menu: { items: [{ ingredients: [] }] } },
        { date: "2026-11-22", menu: { items: [] } },
        { date: "2026-11-23", menu: null },
      ]),
    ).toEqual(new Set(["2026-11-21"]));
  });
});
