import type { components } from "@ketocare/api-client";
import {
  TOLERANCE_GAP_KEY,
  TOLERANCE_GAP_UNKNOWN_KEY,
  type DayTolerance,
  type ToleranceGap,
} from "@ketocare/ui";
import { describe, expect, expectTypeOf, it } from "vitest";

import doctorRu from "../../locales/ru/doctor.json";
import homeRu from "../../locales/ru/home.json";
import menuRu from "../../locales/ru/menu.json";

/**
 * Правило вердикта живёт в ките (`dayVerdict`), а словари — здесь, у экранов.
 *
 * Ключ, которого нет в словаре, i18n показывает самим ключом: на экране семьи
 * вместо объяснения появится строка «day.engineUnknown». Экран при этом не
 * падает, тест экрана тоже — поэтому полнота проверяется здесь, по списку
 * причин сервера.
 */
describe("словари объясняют каждую причину сервера", () => {
  const screens: Array<[string, Record<string, unknown>]> = [
    ["главная семьи", homeRu.day as Record<string, unknown>],
    [
      "карта пациента",
      (doctorRu.summary as { day: Record<string, unknown> }).day,
    ],
    ["меню", menuRu.totals as Record<string, unknown>],
  ];

  it.each(screens)("%s", (_name, dictionary) => {
    for (const key of Object.values(TOLERANCE_GAP_KEY)) {
      expect(typeof dictionary[key]).toBe("string");
    }
    // И нейтральный текст на случай, когда причины нет вовсе.
    expect(typeof dictionary[TOLERANCE_GAP_UNKNOWN_KEY]).toBe("string");
  });
});

/**
 * Кит не зависит от клиента API и повторяет форму вердикта структурно. Сервер
 * добавит причину — здесь упадёт проверка типов (`make lint`), а не экран семьи
 * молча покажет ключ словаря.
 */
describe("форма вердикта в ките совпадает с OpenAPI", () => {
  it("причины и вердикт — те же, что отдаёт сервер", () => {
    expectTypeOf<ToleranceGap>().toEqualTypeOf<
      components["schemas"]["ToleranceGap"]
    >();
    expectTypeOf<DayTolerance>().toEqualTypeOf<
      components["schemas"]["DayTolerance"]
    >();
  });
});
