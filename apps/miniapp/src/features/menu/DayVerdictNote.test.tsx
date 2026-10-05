import { TOLERANCE_GAP_KEY, TOLERANCE_GAP_UNKNOWN_KEY } from "@ketocare/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../../lib/i18n";
import ru from "../../locales/ru/app.json";
import { DayVerdictNote } from "./DayVerdictNote";

/**
 * Ключ, которого нет в словаре, i18n показывает самим ключом: семья увидела бы
 * строку «verdict.engineUnknown» вместо объяснения. Экран при этом не падает,
 * поэтому полнота проверяется по списку причин сервера из кита.
 */
describe("словарь Mini App объясняет каждую причину сервера", () => {
  it("для каждой причины и для её отсутствия есть текст", () => {
    const dictionary = ru.verdict as Record<string, unknown>;
    for (const key of Object.values(TOLERANCE_GAP_KEY)) {
      expect(typeof dictionary[key]).toBe("string");
    }
    expect(typeof dictionary[TOLERANCE_GAP_UNKNOWN_KEY]).toBe("string");
  });

  it("без соотношения ни тревоги, ни похвалы", () => {
    render(
      <DayVerdictNote
        tolerance={{
          ratio_within_tolerance: null,
          kcal_within_tolerance: true,
        }}
        gap={null}
        kcal={500}
        targetKcal={1200}
      />,
    );

    expect(
      screen.getByText(/Кетосоотношение дня не определено/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Кетосоотношение дня соответствует назначению."),
    ).not.toBeInTheDocument();
  });
});
