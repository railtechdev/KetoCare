import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Field, SelectField, TextAreaField } from "./Field";

/**
 * Один набор проверок на три поля: подпись, связь ошибки и проброс ref у них
 * общие, и разойтись они не должны. Пока обвязка была скопирована по трём
 * файлам, проверка одной копии ничего не говорила о двух других.
 */
const CASES = [
  {
    name: "Field",
    element: (props: { error?: string }) => (
      <Field id="f" label="Кетоны, ммоль/л" {...props} />
    ),
    role: "textbox" as const,
  },
  {
    name: "SelectField",
    element: (props: { error?: string }) => (
      <SelectField id="f" label="Кетоны, ммоль/л" {...props}>
        <option value="blood">Кровь</option>
      </SelectField>
    ),
    role: "combobox" as const,
  },
  {
    name: "TextAreaField",
    element: (props: { error?: string }) => (
      <TextAreaField id="f" label="Кетоны, ммоль/л" {...props} />
    ),
    role: "textbox" as const,
  },
];

describe.each(CASES)("$name", ({ element, role }) => {
  it("связывает подпись с элементом ввода", () => {
    render(element({}));
    expect(
      screen.getByRole(role, { name: "Кетоны, ммоль/л" }),
    ).toBeInTheDocument();
  });

  it("без ошибки не помечает поле недостоверным", () => {
    render(element({}));
    const control = screen.getByRole(role);
    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("объявляет ошибку скринридеру, а не только цветом рамки", () => {
    // Красная рамка — единственный признак ошибки для зрячего пользователя;
    // незрячий узнаёт о ней только по этой связи.
    render(element({ error: "Значение вне допустимого диапазона" }));
    const control = screen.getByRole(role);

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(
      "Значение вне допустимого диапазона",
    );
  });
});

describe("поля формы", () => {
  it("пробрасывают ref: без него react-hook-form считает поле пустым", () => {
    const input = createRef<HTMLInputElement>();
    const select = createRef<HTMLSelectElement>();
    const textarea = createRef<HTMLTextAreaElement>();

    render(
      <>
        <Field id="a" label="Строка" ref={input} />
        <SelectField id="b" label="Список" ref={select}>
          <option value="x">x</option>
        </SelectField>
        <TextAreaField id="c" label="Текст" ref={textarea} />
      </>,
    );

    expect(input.current).toBeInstanceOf(HTMLInputElement);
    expect(select.current).toBeInstanceOf(HTMLSelectElement);
    expect(textarea.current).toBeInstanceOf(HTMLTextAreaElement);
  });
});
