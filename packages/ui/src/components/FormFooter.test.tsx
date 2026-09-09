import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormFooter } from "./FormFooter";

describe("FormFooter: причина, по которой не отправить", () => {
  it("связывает строку с кнопкой, чтобы её прочитал скринридер", () => {
    render(
      <FormFooter
        submitLabel="Сохранить"
        pendingLabel="Сохраняем…"
        disabled
        reason="Блюдо не названо."
      />,
    );

    const submit = screen.getByRole("button", { name: "Сохранить" });
    const reason = screen.getByText("Блюдо не названо.");
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-describedby", reason.id);
  });

  it("молчит во время отправки: кнопка выключена, но объяснять нечего", () => {
    render(
      <FormFooter
        submitLabel="Сохранить"
        pendingLabel="Сохраняем…"
        pending
        disabled
        reason="Блюдо не названо."
      />,
    );

    expect(screen.queryByText("Блюдо не названо.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Сохраняем…" }),
    ).not.toHaveAttribute("aria-describedby");
  });

  it("без причины ничего не показывает — правило не обязывает её выдумывать", () => {
    render(
      <FormFooter submitLabel="Сохранить" pendingLabel="Сохраняем…" disabled />,
    );

    expect(
      screen.getByRole("button", { name: "Сохранить" }),
    ).not.toHaveAttribute("aria-describedby");
  });
});
