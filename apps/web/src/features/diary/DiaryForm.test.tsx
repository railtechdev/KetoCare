import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import commonRu from "../../locales/ru/common.json";
import diaryRu from "../../locales/ru/diary.json";
import { DiaryForm } from "./DiaryForm";

i18n.addResourceBundle("ru", "diary", diaryRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);

function renderForm(kind: "ketones" | "seizures") {
  const onSubmit = vi.fn();
  render(
    <DiaryForm
      kind={kind}
      editing={null}
      seizureTypes={[{ id: "t1", name: "Фокальный" }]}
      durationOptions={[]}
      medications={[]}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      pending={false}
      error={null}
    />,
  );
  return onSubmit;
}

/**
 * Правило П8: после неудачной отправки над формой встаёт сводка ошибок,
 * забирает фокус, а её строки ведут в поля. Родитель заполняет дневник с
 * телефона, и ошибка под полем, оставшимся выше экранной клавиатуры, без
 * сводки не видна вовсе.
 */
describe("сводка ошибок записи дневника", () => {
  it("кетоны без значения: сводка с тем же текстом, что у поля", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm("ketones");

    await user.click(screen.getByRole("button", { name: diaryRu.form.add }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveFocus();
    const link = within(summary).getByRole("link");
    // Текст строки совпадает с сообщением под полем: две разные формулировки
    // читались бы как две разные ошибки.
    const field = screen.getByLabelText(diaryRu.ketones.value);
    const fieldError = document.getElementById(`${field.id}-error`);
    expect(link.textContent).toBe(fieldError?.textContent);

    await user.click(link);
    expect(field).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("приступ: сводка появляется уже на первом шаге", async () => {
    // Первый шаг проверяется не отправкой, а переходом «Далее» — и без своего
    // счётчика попыток сводка на нём не появлялась бы никогда.
    const user = userEvent.setup();
    renderForm("seizures");

    await user.click(screen.getByRole("button", { name: diaryRu.form.next }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveFocus();
    await user.click(
      within(summary).getByRole("link", {
        name: diaryRu.seizures.typeRequired,
      }),
    );
    expect(screen.getByLabelText(diaryRu.seizures.type)).toHaveFocus();
  });
});
