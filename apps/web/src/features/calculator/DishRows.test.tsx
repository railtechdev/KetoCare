import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import calculatorRu from "../../locales/ru/calculator.json";
import { DishResultView } from "./DishResultView";
import { DishRows } from "./DishRows";
import type { DishRow } from "./types";

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const ROW: DishRow = {
  product: {
    id: "broccoli",
    name: "Брокколи",
    kcal: 34,
    fat: 0.4,
    protein: 2.8,
    carbs: 6.6,
    fiber: 2.6,
    isActive: true,
  },
  grams: 37.4,
};

const DISH = {
  kcal: 300,
  fat_g: 30.1,
  protein_g: 3.2,
  carbs_g: 6,
  fiber_g: 1.5,
  net_carbs_g: 4.5,
  ratio: 3.9,
  engine_version: "1.3.0",
};

describe("DishRows stepper", () => {
  it("adds and removes one gram, keeping tenths from the solver", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DishRows rows={[ROW]} onChangeGrams={onChange} />);

    await user.click(screen.getByRole("button", { name: /Прибавить 1 г/ }));
    expect(onChange).toHaveBeenLastCalledWith("broccoli", 38.4);

    await user.click(screen.getByRole("button", { name: /Убавить 1 г/ }));
    expect(onChange).toHaveBeenLastCalledWith("broccoli", 36.4);
  });

  it("never goes below zero", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DishRows rows={[{ ...ROW, grams: 0.4 }]} onChangeGrams={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: /Убавить 1 г/ }));

    expect(onChange).toHaveBeenLastCalledWith("broccoli", 0);
  });

  it("shows no stepper while the grams are read-only", () => {
    render(<DishRows rows={[ROW]} readOnlyGrams />);

    expect(screen.queryByRole("button", { name: /Прибавить 1 г/ })).toBeNull();
  });

  it("shows net carbs and fiber of the position", () => {
    render(
      <DishRows
        rows={[ROW]}
        contributions={
          new Map([
            [
              "broccoli",
              {
                kcal: 13,
                fat_g: 0.1,
                protein_g: 1,
                carbs_g: 2.5,
                fiber_g: 1,
                net_carbs_g: 1.5,
              },
            ],
          ])
        }
      />,
    );

    const facts = screen.getByRole("group", { name: /Брокколи/ });
    expect(facts).toHaveTextContent("чист.1,5");
    expect(facts).toHaveTextContent("клетч.1,0");
  });
});

describe("DishResultView goal table", () => {
  const goal = { ratio: 4, kcal: 300, proteinMin: null, carbsMax: null };

  it("puts fact and goal side by side for every macro", () => {
    render(
      <DishResultView
        dish={DISH}
        goal={goal}
        mealGoal={{
          fat_g: 30,
          protein_g: 4.85,
          net_carbs_g: 2.65,
          non_fat_g: 7.5,
        }}
      />,
    );

    const fat = screen.getByRole("row", { name: /^Жиры/ });
    expect(fat).toHaveTextContent("30,1");
    expect(fat).toHaveTextContent("30,0");
    const nonFat = screen.getByRole("row", { name: /Белки \+ чистые/ });
    expect(nonFat).toHaveTextContent("7,7");
    expect(nonFat).toHaveTextContent("7,5");
  });

  it("shows a dash when the protein split is unknown", () => {
    render(
      <DishResultView
        dish={DISH}
        goal={goal}
        mealGoal={{
          fat_g: 30,
          protein_g: null,
          net_carbs_g: null,
          non_fat_g: 7.5,
        }}
      />,
    );

    expect(screen.getByRole("row", { name: /^Белки \d/ })).toHaveTextContent(
      "—",
    );
  });

  it("draws no table without a goal", () => {
    render(<DishResultView dish={DISH} goal={null} />);

    expect(screen.queryByRole("table")).toBeNull();
  });
});
