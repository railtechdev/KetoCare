import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FormSheet } from "./FormSheet";

describe("FormSheet", () => {
  it("кнопка закрытия подписана словарём экрана, а не по-английски", async () => {
    // Встроенная кнопка кита подписана «Close» и так зачитывалась в русском
    // интерфейсе; она же стояла поверх длинного заголовка.
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FormSheet
        open
        onOpenChange={onOpenChange}
        title="Профиль: Аня Иванова"
        closeLabel="Закрыть"
      >
        <p>форма</p>
      </FormSheet>,
    );

    const close = screen.getByRole("button", { name: "Закрыть" });
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    await user.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("при открытии фокус встаёт на первое поле, а не на «Закрыть»", () => {
    // Кнопка закрытия стоит в шапке, то есть первой в панели. Фокус на ней
    // превращал привычный Enter в закрытие — в панели временного пароля
    // пароль после этого второй раз не показать.
    render(
      <FormSheet
        open
        onOpenChange={vi.fn()}
        title="Новый препарат"
        closeLabel="Закрыть"
      >
        <label>
          Название
          <input />
        </label>
        <button type="button">Сохранить</button>
      </FormSheet>,
    );

    expect(screen.getByRole("textbox", { name: "Название" })).toHaveFocus();
  });

  it("значение поля правки выделено: набор заменяет его, а не дописывает", () => {
    render(
      <FormSheet
        open
        onOpenChange={vi.fn()}
        title="Переименовать блюдо"
        closeLabel="Закрыть"
      >
        <label>
          Название
          <input defaultValue="Суп" />
        </label>
      </FormSheet>,
    );

    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Название",
    });
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
  });

  it("пропускает недоступное поле и кнопку вне обхода Tab", () => {
    render(
      <FormSheet
        open
        onOpenChange={vi.fn()}
        title="Новый препарат"
        closeLabel="Закрыть"
      >
        <button type="button" tabIndex={-1}>
          Подсказка
        </button>
        <fieldset disabled>
          <label>
            Старое поле
            <input />
          </label>
        </fieldset>
        <label>
          Название
          <input />
        </label>
      </FormSheet>,
    );

    expect(screen.getByRole("textbox", { name: "Название" })).toHaveFocus();
  });

  it("без полей фокус остаётся на кнопке закрытия", () => {
    render(
      <FormSheet
        open
        onOpenChange={vi.fn()}
        title="Справка"
        closeLabel="Закрыть"
      >
        <p>только текст</p>
      </FormSheet>,
    );

    expect(screen.getByRole("button", { name: "Закрыть" })).toHaveFocus();
  });
});
