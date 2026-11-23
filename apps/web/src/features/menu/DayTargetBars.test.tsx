import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { DayTargetBars } from "./DayTargetBars";

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

/**
 * Белок назначения — минимум (аудит ядра 15.11.2026, М1): полоса показывает,
 * сколько не добрано, и не появляется там, где белка назначения не передали.
 */
describe("полоса белка в итогах дня", () => {
  it("называет недобор до нормы назначения", () => {
    render(
      <DayTargetBars
        kcal={900}
        carbs={12}
        kcalTarget={1380}
        carbsLimit={21.5}
        protein={18.5}
        proteinMin={23}
      />,
    );
    expect(screen.getByText("Белок, не меньше")).toBeInTheDocument();
    expect(screen.getByText("18,5 из 23,0 г")).toBeInTheDocument();
    expect(
      screen.getByText("до нормы назначения ещё 4,5 г"),
    ).toBeInTheDocument();
  });

  it("набранная норма — без «ещё»", () => {
    render(
      <DayTargetBars
        kcal={1380}
        carbs={20}
        kcalTarget={1380}
        carbsLimit={21.5}
        protein={24}
        proteinMin={23}
      />,
    );
    expect(screen.getByText("норма назначения набрана")).toBeInTheDocument();
  });

  it("без белка назначения полосы нет", () => {
    render(
      <DayTargetBars
        kcal={900}
        carbs={12}
        kcalTarget={1380}
        carbsLimit={21.5}
      />,
    );
    expect(screen.queryByText("Белок, не меньше")).toBeNull();
  });
});

/**
 * Слова под полосой калорийности (вопрос клиники 23.11.2026): каждый приём в
 * цели, а день «±1 ккал» — это округление, и экран не должен просить добавить
 * одну килокалорию. Правило — `dayKcalHint` кита, одно на кабинет и Mini App.
 */
describe("полоса калорийности в итогах дня", () => {
  it.each([
    [1199, "1 199 из 1 200 ккал"],
    [1201, "1 201 из 1 200 ккал"],
    [1200, "1 200 из 1 200 ккал"],
  ])("день %s из 1 200 — «суточная норма набрана»", (kcal, bar) => {
    render(
      <DayTargetBars
        kcal={kcal}
        carbs={8}
        kcalTarget={1200}
        carbsLimit={10}
        mealsPerDay={4}
      />,
    );
    expect(screen.getByText("Суточная норма набрана")).toBeInTheDocument();
    // Число на полосе — как пришло: слова его не подменяют и не округляют.
    expect(screen.getByText(bar)).toBeInTheDocument();
    expect(screen.queryByText(/добавьте ещё/)).toBeNull();
    expect(screen.queryByText(/сверх нормы/)).toBeNull();
  });

  it("настоящий недобор и настоящее превышение называются числом", () => {
    const { unmount } = render(
      <DayTargetBars
        kcal={850}
        carbs={8}
        kcalTarget={1200}
        carbsLimit={10}
        mealsPerDay={4}
      />,
    );
    expect(
      screen.getByText("Чтобы набрать суточную норму, добавьте ещё 350 ккал"),
    ).toBeInTheDocument();
    unmount();

    render(
      <DayTargetBars
        kcal={1260}
        carbs={8}
        kcalTarget={1200}
        carbsLimit={10}
        mealsPerDay={4}
      />,
    );
    expect(screen.getByText("сверх нормы 60 ккал")).toBeInTheDocument();
  });

  it("запас растёт с числом приёмов и не больше округления их целей", () => {
    // Шесть приёмов: цель приёма округлена до целого, шесть целей расходятся
    // с суточной нормой не больше чем на три килокалории.
    const { unmount } = render(
      <DayTargetBars
        kcal={1303}
        carbs={8}
        kcalTarget={1300}
        carbsLimit={10}
        mealsPerDay={6}
      />,
    );
    expect(screen.getByText("Суточная норма набрана")).toBeInTheDocument();
    unmount();

    render(
      <DayTargetBars
        kcal={1304}
        carbs={8}
        kcalTarget={1300}
        carbsLimit={10}
        mealsPerDay={6}
      />,
    );
    expect(screen.getByText("сверх нормы 4 ккал")).toBeInTheDocument();
  });

  it("без числа приёмов прощается одна килокалория", () => {
    render(
      <DayTargetBars kcal={1198} carbs={8} kcalTarget={1200} carbsLimit={10} />,
    );
    expect(
      screen.getByText("Чтобы набрать суточную норму, добавьте ещё 2 ккал"),
    ).toBeInTheDocument();
  });
});
