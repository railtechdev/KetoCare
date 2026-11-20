import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

function renderOpen(destructive?: boolean) {
  render(
    <ConfirmDialog
      open
      title="Удалить блюдо «Завтрак»?"
      confirmLabel="Удалить блюдо"
      cancelLabel="Оставить"
      destructive={destructive}
      onConfirm={() => undefined}
    />,
  );
  return screen.getByRole("button", { name: "Удалить блюдо" });
}

describe("ConfirmDialog", () => {
  it("опасное подтверждение — красное, без синего варианта по умолчанию", () => {
    // Классы на `AlertDialogAction` склеивались Slot'ом без tailwind-merge, и
    // `bg-primary` побеждал `bg-destructive`: «Удалить» было синим, как
    // безопасное «Добавить в меню» рядом.
    const action = renderOpen();

    expect(action).toHaveAttribute("data-variant", "destructive");
    expect(action.className).toContain("bg-destructive");
    expect(action.className).not.toContain("bg-primary");
  });

  it("безопасное подтверждение — основная кнопка", () => {
    const action = renderOpen(false);

    expect(action).toHaveAttribute("data-variant", "default");
    expect(action.className).toContain("bg-primary");
    expect(action.className).not.toContain("bg-destructive");
  });
});
