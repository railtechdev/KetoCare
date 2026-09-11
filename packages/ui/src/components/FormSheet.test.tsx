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
});
