import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./ChatComposer";

const LABELS = {
  placeholder: "Спросите о приложении",
  sendLabel: "Спросить",
  sendingLabel: "Отправляем…",
  audience: {
    summary: "Вопросы видят врач и диетолог",
    details: "Иванова Анна (врач). О срочном звоните в клинику.",
    detailsLabel: "Кто именно",
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatComposer", () => {
  it("пустой вопрос не отправляется", async () => {
    const onSubmit = vi.fn();
    render(
      <ChatComposer
        value="   "
        onChange={() => {}}
        onSubmit={onSubmit}
        {...LABELS}
      />,
    );

    expect(screen.getByRole("button", { name: "Спросить" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("поле и кнопка-значок — одной строкой, поле начинается с одной строки", () => {
    // П2: прежние поле в две строки, подсказка и кнопка под ними занимали
    // треть телефона.
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        hint={undefined}
        {...LABELS}
      />,
    );

    const field = screen.getByLabelText("Спросите о приложении");
    const button = screen.getByRole("button", { name: "Спросить" });
    expect(field).toHaveAttribute("rows", "1");
    expect(field.parentElement).toBe(button.parentElement);
    // Подпись — для программы чтения с экрана; на кнопке только значок.
    expect(button).toHaveTextContent("");
    expect(button.className).toContain("size-(--spacing-touch)");
  });

  it("во время отправки кнопка занята и повторно не срабатывает", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatComposer
        value="вопрос"
        onChange={() => {}}
        onSubmit={onSubmit}
        pending
        {...LABELS}
      />,
    );

    const button = screen.getByRole("button", { name: "Отправляем…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("когда спрашивать нельзя, поле недоступно", () => {
    // Исчерпан суточный предел: поле, принимающее текст, который никуда не
    // уйдёт, обещает работу, которой не будет.
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled
        {...LABELS}
      />,
    );

    expect(screen.getByLabelText("Спросите о приложении")).toBeDisabled();
  });

  it("называет, кто прочтёт вопрос, — до поля, а не после отправки", () => {
    // Человек пишет иначе, когда знает, что его читает врач (ADR-0022):
    // предупреждение после отправки уже ничего не меняет.
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        {...LABELS}
      />,
    );

    const note = screen.getByText(LABELS.audience.summary);
    const field = screen.getByLabelText("Спросите о приложении");
    expect(
      note.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("видна одна строка о читателях, подробности — по нажатию (Р1)", async () => {
    const user = userEvent.setup();
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        {...LABELS}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Кто именно" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(LABELS.audience.details)).not.toBeVisible();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(LABELS.audience.details)).toBeVisible();
  });

  it("без подробностей кнопки раскрытия нет", () => {
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        {...LABELS}
        audience={{ summary: "Вопросы видит врач" }}
      />,
    );

    expect(screen.getByText("Вопросы видит врач")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Кто именно" })).toBeNull();
  });

  it("без строки о читателях экран не собирается", () => {
    // Проверка типов: `@ts-expect-error` падает, если ошибки нет.
    const composer = (
      // @ts-expect-error — `audience` обязательна (ADR-0022)
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="п"
        sendLabel="с"
        sendingLabel="о"
      />
    );
    expect(composer).toBeTruthy();
  });

  it("сообщает о фокусе поля — Mini App прячет полосу вкладок", () => {
    vi.useFakeTimers();
    const onFocusChange = vi.fn();
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onFocusChange={onFocusChange}
        {...LABELS}
      />,
    );

    const field = screen.getByLabelText("Спросите о приложении");
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(onFocusChange.mock.calls).toEqual([[true]]);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
  });

  it("потерю фокуса сообщает после нажатия, а вернувшийся фокус — не потеря", () => {
    // На Android касание «Спросить» уводит фокус с поля на mousedown. Сообщи
    // поле об этом сразу — полоса вкладок вернётся, поле уедет на 4rem вверх
    // до mouseup, и щелчок попадёт в полосу, а не в кнопку.
    vi.useFakeTimers();
    const onFocusChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <ChatComposer
        value="вопрос"
        onChange={() => {}}
        onSubmit={onSubmit}
        onFocusChange={onFocusChange}
        {...LABELS}
      />,
    );

    const field = screen.getByLabelText("Спросите о приложении");
    const send = screen.getByRole("button", { name: "Спросить" });
    fireEvent.focus(field);
    fireEvent.mouseDown(send);
    fireEvent.blur(field, { relatedTarget: send });
    fireEvent.mouseUp(send);
    // До конца касания раскладка не меняется: потеря ещё не сообщена.
    expect(onFocusChange.mock.calls).toEqual([[true]]);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(onFocusChange.mock.calls).toEqual([[true], [false]]);

    // Фокус ушёл и сразу вернулся — клавиатура не закрывалась.
    onFocusChange.mockClear();
    fireEvent.blur(field);
    field.focus();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(onFocusChange.mock.calls).toEqual([[true]]);
  });

  describe("рост поля без `field-sizing` (Safari, WebView iOS)", () => {
    function stubLayout(supportsFieldSizing: boolean) {
      vi.stubGlobal("CSS", { supports: () => supportsFieldSizing });
      // Строка — 20 px, поля — 16 px; рамка по 1 px, потолок — 98 px.
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
        function (this: HTMLElement) {
          const lines =
            this instanceof HTMLTextAreaElement
              ? this.value.split("\n").length
              : 1;
          return lines * 20 + 16;
        },
      );
      const real = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
        element instanceof HTMLTextAreaElement
          ? ({
              borderTopWidth: "1px",
              borderBottomWidth: "1px",
              maxHeight: "98px",
            } as CSSStyleDeclaration)
          : real(element),
      );
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function renderWith(value: string) {
      return render(
        <ChatComposer
          value={value}
          onChange={() => {}}
          onSubmit={() => {}}
          {...LABELS}
        />,
      );
    }

    it("растёт по содержимому и останавливается на потолке", () => {
      stubLayout(false);
      const { rerender } = renderWith("одна строка");
      const field = screen.getByLabelText<HTMLTextAreaElement>(
        "Спросите о приложении",
      );
      expect(field.style.height).toBe("38px");

      const props = { onChange: () => {}, onSubmit: () => {}, ...LABELS };
      rerender(<ChatComposer value={"раз\nдва\nтри"} {...props} />);
      expect(field.style.height).toBe("78px");

      // Шесть строк — выше четырёх: поле стоит на потолке и прокручивается.
      rerender(<ChatComposer value={"1\n2\n3\n4\n5\n6"} {...props} />);
      expect(field.style.height).toBe("98px");
    });

    it("где `field-sizing` есть, высоту не трогает", () => {
      stubLayout(true);
      renderWith("раз\nдва\nтри");
      expect(
        screen.getByLabelText<HTMLTextAreaElement>("Спросите о приложении")
          .style.height,
      ).toBe("");
    });
  });

  it("Enter отправляет только с мышью", () => {
    const onSubmit = vi.fn();
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({ matches: query === "(pointer: fine)" }) as MediaQueryList;
    try {
      render(
        <ChatComposer
          value="вопрос"
          onChange={() => {}}
          onSubmit={onSubmit}
          {...LABELS}
        />,
      );
      fireEvent.keyDown(screen.getByLabelText("Спросите о приложении"), {
        key: "Enter",
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = original;
    }
  });
});
