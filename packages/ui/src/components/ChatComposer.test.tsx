import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./ChatComposer";

const LABELS = {
  placeholder: "Спросите о приложении",
  sendLabel: "Спросить",
  sendingLabel: "Отправляем…",
};

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
});
