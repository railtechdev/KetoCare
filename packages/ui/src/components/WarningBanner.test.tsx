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

  it("показывает заголовок, если он задан", () => {
    render(
      <WarningBanner title="Проверьте меню">
        Соотношение ниже назначенного
      </WarningBanner>,
    );
    expect(screen.getByText("Проверьте меню")).toBeInTheDocument();
  });
});
