import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendChart, type TrendPoint } from "./TrendChart";

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const POINTS: TrendPoint[] = [
  { at: new Date("2026-03-03T08:00:00Z"), value: 3.2 },
  { at: new Date("2026-03-01T08:00:00Z"), value: 2.8 },
  { at: new Date("2026-03-02T08:00:00Z"), value: 4.1 },
];

describe("TrendChart", () => {
  it("показывает пустое состояние без данных", () => {
    render(
      <TrendChart
        points={[]}
        unit="ммоль/л"
        caption="Кетоны"
        emptyState="Нет измерений"
        formatDate={formatDate}
      />,
    );
    expect(screen.getByText("Нет измерений")).toBeInTheDocument();
  });

  it("даёт текстовую альтернативу графику, отсортированную по времени", () => {
    // Линию скринридер не прочитает — без таблицы данные были бы недоступны.
    render(
      <TrendChart
        points={POINTS}
        unit="ммоль/л"
        caption="Кетоны за период"
        emptyState="Нет измерений"
        formatDate={formatDate}
      />,
    );

    const table = screen.getByRole("table", { name: "Кетоны за период" });
    const dates = Array.from(table.querySelectorAll("th")).map(
      (th) => th.textContent,
    );
    expect(dates).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  it("подписывает график для скринридера", () => {
    render(
      <TrendChart
        points={POINTS}
        unit="кг"
        caption="Вес ребёнка"
        emptyState="Нет измерений"
        formatDate={formatDate}
      />,
    );
    expect(
      screen.getByText("Вес ребёнка", { selector: "figcaption" }),
    ).toBeInTheDocument();
  });

  it("принимает маркеры смены назначения", () => {
    // Без маркеров скачок показателя выглядит как ухудшение состояния,
    // хотя это следствие изменённой терапии (раздел 8.2 ТЗ).
    const { container } = render(
      <TrendChart
        points={POINTS}
        markers={[
          { at: new Date("2026-03-02T00:00:00Z"), label: "Назначение v2" },
        ]}
        unit="ммоль/л"
        caption="Кетоны"
        emptyState="Нет измерений"
        formatDate={formatDate}
      />,
    );
    expect(container.querySelector("figure")).not.toBeNull();
  });
});
