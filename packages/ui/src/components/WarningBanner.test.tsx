import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WarningBanner } from "./WarningBanner";

describe("WarningBanner", () => {
  it("по умолчанию — предупреждение со статусной ролью", () => {
    render(<WarningBanner>Меню выходит за допуски</WarningBanner>);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-level", "warning");
    expect(banner).toHaveTextContent("Меню выходит за допуски");
  });

  it("опасность объявляется немедленно (role=alert)", () => {
    // Выход за пределы назначения не должен ждать, пока скринридер закончит
    // читать остальное: это клинически значимое сообщение.
    render(
      <WarningBanner level="danger">Превышен лимит углеводов</WarningBanner>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-level", "danger");
  });

  it("уровень различается не только цветом", () => {
    // Цвет полосы слева был единственным признаком уровня для зрячего: при
    // дальтонизме и на чёрно-белой печати выписки предупреждение выглядело так
    // же, как опасность (WCAG 1.4.1). Соседний `PatientFlagsView` это правило
    // соблюдал, баннер — нет.
    const { container: warning } = render(
      <WarningBanner level="warning">Соотношение ниже цели</WarningBanner>,
    );
    const { container: danger } = render(
      <WarningBanner level="danger">Превышен лимит</WarningBanner>,
    );

    const iconOf = (root: HTMLElement) =>
      root.querySelector("svg")?.getAttribute("class") ?? "";

    expect(iconOf(warning)).not.toBe("");
    expect(iconOf(danger)).not.toBe("");
    expect(iconOf(warning)).not.toBe(iconOf(danger));
  });

  it("длинный заголовок не обрезается одной строкой", () => {
    // У кита заголовок короткий и обрезан `line-clamp-1`. У нас это фраза
    // «Кетосоотношение дня выходит за допуски назначения» — в приставной
    // колонке она занимает три строки, и обрезка съела бы смысл.
    render(
      <WarningBanner title="Кетосоотношение дня выходит за допуски назначения">
        Текст
      </WarningBanner>,
    );

    expect(
      screen.getByText("Кетосоотношение дня выходит за допуски назначения"),
    ).toHaveClass("line-clamp-none");
  });

  it("показывает заголовок, если он задан", () => {
    render(
      <WarningBanner title="Проверьте меню">
        Соотношение ниже назначенного
      </WarningBanner>,
    );
    expect(screen.getByText("Проверьте меню")).toBeInTheDocument();
  });
});
