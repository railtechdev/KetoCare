import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import homeRu from "../../locales/ru/home.json";
import { DayTotalsCard } from "./DayTotalsCard";
import type { DaySummary } from "./types";

/** Итоги дня, каких хватает карточке: сами числа её вердикта не меняют. */
function day(overrides: Partial<DaySummary> = {}): DaySummary {
  return {
    totals: {
      kcal: 1200,
      fat: 100,
      protein: 24,
      carbs: 10,
      fiber: 2,
      ratio: 3.5,
    },
    tolerance: null,
    tolerance_gap: null,
    engine_version: "1.0.0",
    ...overrides,
  };
}

i18n.addResourceBundle("ru", "home", homeRu, true, true);

/**
 * Регрессия по правилу П27 канона: пустое состояние на экране одно.
 *
 * Когда меню на день не составлено, об этом говорит блок «Ближайший приём
 * пищи» — с иконкой, объяснением и кнопкой «Составить меню». Итоги дня
 * показывали ровно такое же пустое состояние с той же кнопкой сразу под ним:
 * два одинаковых призыва подряд читаются как два разных дела.
 */
describe("итоги дня без меню", () => {
  it("сжимаются до строки и не повторяют кнопку соседнего блока", () => {
    render(<DayTotalsCard day={null} targetKcal={1200} />);

    expect(screen.getByText(homeRu.day.empty)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: homeRu.day.planMenu }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: homeRu.day.emptyTitle }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Вердикта нет по двум разным причинам, и семья должна прочитать верную.
 *
 * Пока текст был один, день, посчитанный прежней основной версией ядра
 * (соотношение считалось по общим углеводам, ADR-0030), объяснялся семье как
 * «активного назначения нет» — при живом назначении. Это прямая неправда о
 * терапии ребёнка, а не оплошность формулировки.
 */
describe("почему у дня нет вердикта", () => {
  it("нет назначения — так и сказано", () => {
    render(
      <DayTotalsCard
        day={day({ tolerance_gap: "no_prescription" })}
        targetKcal={null}
      />,
    );

    expect(screen.getByText(homeRu.day.noPrescription)).toBeInTheDocument();
  });

  it("прежняя версия ядра — про назначение не говорится ни слова", () => {
    render(
      <DayTotalsCard
        day={day({ tolerance_gap: "engine_changed", engine_version: "0.4.0" })}
        targetKcal={1200}
      />,
    );

    expect(screen.getByText(homeRu.day.engineChanged)).toBeInTheDocument();
    expect(
      screen.queryByText(homeRu.day.noPrescription),
    ).not.toBeInTheDocument();
  });
});
