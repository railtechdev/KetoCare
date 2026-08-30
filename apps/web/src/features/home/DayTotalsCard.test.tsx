import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import homeRu from "../../locales/ru/home.json";
import { DayTotalsCard } from "./DayTotalsCard";

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
