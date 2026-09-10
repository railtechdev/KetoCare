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

describe("чистые углеводы", () => {
  it("показываются подписью из словаря приложения, а не своей", () => {
    // Формулировка клиническая: править её будет медицинская команда, как
    // дисклеймер помощника, — поэтому текст приходит пропом.
    render(
      <MacroBar
        fatG={40}
        proteinG={2}
        carbsG={6.6}
        netCarbs={{ grams: 4.08, label: "Из них чистых:" }}
      />,
    );

    const line = screen.getByText(/Из них чистых:/);
    expect(line).toHaveTextContent("4.1 г");
  });

  it("число стоит внутри фразы, а не в её конце", () => {
    // Собранная как «подпись плюс число», строка читалась «по ним считается
    // кетосоотношение: 4,1 г» — то есть обещала, что соотношение и есть эти
    // граммы. Пояснение обязано идти ПОСЛЕ числа.
    render(
      <MacroBar
        fatG={40}
        proteinG={2}
        carbsG={6.6}
        netCarbs={{
          grams: 4.08,
          label: "Из них чистых углеводов",
          note: "по ним считается кетосоотношение",
        }}
      />,
    );

    // Строка собрана из трёх узлов (число в своём span ради tabular-nums),
    // поэтому сверяется её текст целиком, а не поиск по подстроке.
    const line = screen.getByText(/Из них чистых углеводов/);
    expect(line.textContent).toMatch(
      /^Из них чистых углеводов 4\.1 г — по ним считается кетосоотношение$/,
    );
  });

  it("молчит, когда чистых углеводов не передали", () => {
    // У сохранённых расчётов их не хранится, и восстановить из снимка точно
    // нельзя: строки быть не должно, а не нуля.
    render(<MacroBar fatG={40} proteinG={2} carbsG={6.6} />);

    expect(screen.queryByText(/чистых/)).toBeNull();
  });
});
