import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import { PrescriptionForm } from "./PrescriptionForm";

function renderForm(onSubmit = vi.fn()) {
  render(
    <PrescriptionForm
      defaultValues={{
        ratio: 3.5,
        kcalPerDay: 1200,
        proteinG: 24,
        carbsLimitG: 10,
        mealsPerDay: 4,
        effectiveFrom: "2026-09-09",
      }}
      pending={false}
      error={null}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe("кетосоотношение в назначении", () => {
  it("выбирается из списка и подписано как соотношение", async () => {
    // Врач мыслит «4 : 1», а поле показывало «4»: это класс ошибок, а не
    // косметика. Пометка заказчицы на снимке формы — «4:1 3:1».
    renderForm();

    const field = screen.getByLabelText(/Кетосоотношение/);
    expect(field.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "4.0 : 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3.5 : 1" })).toBeInTheDocument();
  });

  it("предлагает ровно те значения, что разрешает схема", async () => {
    // Список повторяет уже разрешённое: шаг 0,5 от 1 до 5. Новых состояний не
    // появляется — меняется способ ввода, а не набор допустимого. Шаг 0,25,
    // как в KetoDietCalculator, остаётся вопросом K7.
    renderForm();

    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual([
      "5",
      "4.5",
      "4",
      "3.5",
      "3",
      "2.5",
      "2",
      "1.5",
      "1",
    ]);
  });

  it("выбранное значение уходит числом, а не строкой", async () => {
    // Схема назначения ждёт число: строка «4» провалила бы проверку молча.
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText(/Кетосоотношение/), "4");
    await user.click(screen.getByRole("button", { name: /Сохранить|Создать/ }));

    // Второй аргумент — событие формы, поэтому сверяется первый.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ ratio: 4 });
  });
});
