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
    render(<DayTotalsCard day={null} targetKcal={1200} carbsLimit={20} />);

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
        carbsLimit={null}
      />,
    );

    expect(screen.getByText(homeRu.day.noPrescription)).toBeInTheDocument();
  });

  it("прежняя версия ядра — про назначение не говорится ни слова", () => {
    render(
      <DayTotalsCard
        day={day({ tolerance_gap: "engine_changed", engine_version: "0.4.0" })}
        targetKcal={1200}
        carbsLimit={null}
      />,
    );

    expect(screen.getByText(homeRu.day.engineChanged)).toBeInTheDocument();
    expect(
      screen.queryByText(homeRu.day.noPrescription),
    ).not.toBeInTheDocument();
  });

  it("день без соотношения не выдаётся за соответствие назначению", () => {
    // Ревью #214: убрав ложную тревогу, я едва не поставил на её место ложное
    // спокойствие — `null` падал в утвердительную ветку, и родитель читал
    // «соответствует назначению» про день, о котором ядро молчит.
    render(
      <DayTotalsCard
        day={day({
          totals: {
            kcal: 1200,
            fat: 100,
            protein: 24,
            carbs: 10,
            fiber: 10,
            ratio: null,
          },
          tolerance: {
            ratio_within_tolerance: null,
            kcal_within_tolerance: true,
            carbs_within_limit: true,
          },
        })}
        targetKcal={1200}
        carbsLimit={null}
      />,
    );

    expect(
      screen.queryByText(homeRu.day.withinTolerance),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(homeRu.day.offTolerance.title),
    ).not.toBeInTheDocument();
    expect(screen.getByText(homeRu.day.ratioUnknown)).toBeInTheDocument();
  });
});

/**
 * Правило П40: цель — полосой, как в меню. До этого тот же день на главной
 * читался числом, а лимит углеводов не показывался вовсе.
 */
describe("цели дня на главной", () => {
  it("показаны полосами калорийности и лимита углеводов", () => {
    render(<DayTotalsCard day={day()} targetKcal={1400} carbsLimit={20} />);

    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByText("10,0 из 20,0 г")).toBeInTheDocument();
  });

  it("без лимита полос нет — сравнивать не с чем", () => {
    render(<DayTotalsCard day={day()} targetKcal={null} carbsLimit={null} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

/**
 * Р2 аудита Mini App: после первого блюда соотношение почти всегда мимо
 * допуска, и тревога «расходятся с назначением» на 290 из 1 200 ккал говорила
 * семье, что она ошиблась, когда она только начала собирать день.
 */
describe("день ещё собирается", () => {
  const offRatio = {
    ratio_within_tolerance: false,
    kcal_within_tolerance: false,
    carbs_within_limit: true,
  };

  it("норма не набрана — спокойная строка вместо тревоги", () => {
    render(
      <DayTotalsCard
        day={day({
          totals: { ...day().totals, kcal: 290 },
          tolerance: offRatio,
        })}
        targetKcal={1200}
        carbsLimit={20}
      />,
    );

    expect(screen.getByText(homeRu.day.ratioPending)).toBeInTheDocument();
    expect(
      screen.queryByText(homeRu.day.offTolerance.title),
    ).not.toBeInTheDocument();
  });

  it("углеводы сверх лимита — предупреждение сразу", () => {
    render(
      <DayTotalsCard
        day={day({
          totals: { ...day().totals, kcal: 290 },
          tolerance: { ...offRatio, carbs_within_limit: false },
        })}
        targetKcal={1200}
        carbsLimit={20}
      />,
    );

    expect(screen.getByText(homeRu.day.offTolerance.carbs)).toBeInTheDocument();
    expect(
      screen.queryByText(homeRu.day.offTolerance.ratio),
    ).not.toBeInTheDocument();
  });

  it("норма перебрана — расхождение соотношения снова предупреждение", () => {
    render(
      <DayTotalsCard
        day={day({
          totals: { ...day().totals, kcal: 1500 },
          tolerance: offRatio,
        })}
        targetKcal={1200}
        carbsLimit={20}
      />,
    );

    expect(screen.getByText(homeRu.day.offTolerance.ratio)).toBeInTheDocument();
    expect(screen.queryByText(homeRu.day.ratioPending)).not.toBeInTheDocument();
  });
});
