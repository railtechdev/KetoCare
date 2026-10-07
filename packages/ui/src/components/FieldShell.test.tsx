import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldShell, NativeSelect } from "./FieldShell";

describe("FieldShell", () => {
  it("подпись — имя поля, пояснение и ошибка — его описание", () => {
    render(
      <FieldShell
        label="Пароль"
        optionalLabel="необязательно"
        hint="Не короче 12 знаков"
        error="Слишком короткий"
      >
        {({ describedBy, invalid }) => (
          <input aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </FieldShell>,
    );

    // Пояснение не входит в имя: внутри `label` его читали бы как название.
    const field = screen.getByRole("textbox", {
      name: "Пароль (необязательно)",
    });
    expect(field).toHaveAccessibleDescription(
      "Не короче 12 знаков Слишком короткий",
    );
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Слишком короткий");
  });

  it("без ошибки поле не помечено неверным и не описано пустотой", () => {
    render(
      <FieldShell label="Почта">
        {({ describedBy, invalid }) => (
          <input aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </FieldShell>,
    );

    const field = screen.getByRole("textbox", { name: "Почта" });
    expect(field).not.toHaveAttribute("aria-describedby");
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("системный список — с тач-целью", () => {
    render(
      <NativeSelect aria-label="Приём">
        <option>1</option>
      </NativeSelect>,
    );
    expect(screen.getByRole("combobox", { name: "Приём" })).toHaveClass(
      "min-h-touch",
    );
  });
});
