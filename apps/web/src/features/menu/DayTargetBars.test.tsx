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
