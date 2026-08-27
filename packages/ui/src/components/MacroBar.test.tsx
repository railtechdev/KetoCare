import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MacroBar } from "./MacroBar";

/** Доли сегментов в процентах. Числом, а не строкой: jsdom нормализует
 * "50.00%" в "50%", и сравнение строк ломалось бы на форматировании. */
function segmentShares(container: HTMLElement): Record<string, number> {
  const result: Record<string, number> = {};
  container.querySelectorAll<HTMLElement>("[data-macro]").forEach((el) => {
    result[el.dataset.macro!] = Number.parseFloat(el.style.width);
  });
  return result;
}

describe("MacroBar", () => {
  it("делит полосу пропорционально массам", () => {
    const { container } = render(
      <MacroBar fatG={50} proteinG={30} carbsG={20} />,
    );
    expect(segmentShares(container)).toEqual({
      fat: 50,
      protein: 30,
      carbs: 20,
    });
  });

  it("не рисует сегменты нулевой массы", () => {
    const { container } = render(
      <MacroBar fatG={40} proteinG={10} carbsG={0} />,
    );
    const shares = segmentShares(container);
    expect(shares.carbs).toBeUndefined();
    expect(shares.fat).toBe(80);
  });

  it("не падает на полностью нулевом блюде", () => {
    const { container } = render(<MacroBar fatG={0} proteinG={0} carbsG={0} />);
    expect(container.querySelectorAll("[data-macro]")).toHaveLength(0);
  });

  it("игнорирует отрицательные значения при расчёте долей", () => {
    const { container } = render(
      <MacroBar fatG={50} proteinG={-10} carbsG={50} />,
    );
    const shares = segmentShares(container);
    expect(shares.fat).toBe(50);
    expect(shares.carbs).toBe(50);
  });

  it("описывает состав для скринридера", () => {
    render(<MacroBar fatG={50.5} proteinG={12.25} carbsG={3} />);
    expect(
      screen.getByRole("img", {
        name: "Жиры 50.5 г, Белки 12.3 г, Углеводы 3.0 г",
      }),
    ).toBeInTheDocument();
  });
});
