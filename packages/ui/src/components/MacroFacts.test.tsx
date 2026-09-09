import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MacroFacts } from "./MacroFacts";

const LABEL = "Вклад продукта «Масло сливочное» в блюдо";

describe("MacroFacts", () => {
  it("округляет одинаково на всех каналах: калории до целого, макросы до десятых", () => {
    // Своя копия компонента в каждом приложении означала бы своё округление:
    // у одной семьи «41 г жира», у той же семьи с телефона «40.5 г».
    render(
      <MacroFacts
        label={LABEL}
        kcal={367.45}
        fatG={40.58}
        proteinG={0.25}
        carbsG={0.05}
      />,
    );

    const group = screen.getByRole("group", { name: LABEL });
    expect(group).toHaveTextContent("367");
    expect(group).toHaveTextContent("40.6");
    expect(group).toHaveTextContent("0.3");
    expect(group).toHaveTextContent("0.1");
  });

  it("называет нутриенты словами для вспомогательной технологии", () => {
    // Глазу — «Ж 40.5»: на 360 px четыре полных слова в строку не встают.
    // Читающему с экрана набор букв не говорит ничего.
    render(
      <MacroFacts label={LABEL} kcal={100} fatG={10} proteinG={2} carbsG={1} />,
    );

    for (const name of [
      "Калорийность, ккал",
      "Жиры, г",
      "Белки, г",
      "Углеводы, г",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("устаревшие числа помечены, а не спрятаны", () => {
    // Гасить их совсем — значит очищать строку, по которой человек и правит
    // граммовку.
    const { rerender } = render(
      <MacroFacts label={LABEL} kcal={100} fatG={10} proteinG={2} carbsG={1} />,
    );
    expect(screen.getByRole("group", { name: LABEL })).toHaveAttribute(
      "aria-busy",
      "false",
    );

    rerender(
      <MacroFacts
        label={LABEL}
        kcal={100}
        fatG={10}
        proteinG={2}
        carbsG={1}
        stale
      />,
    );
    const group = screen.getByRole("group", { name: LABEL });
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(group).toHaveTextContent("100");
  });
});
