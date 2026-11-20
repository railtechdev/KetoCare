import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatDayDivider, ChatSources, ChatStarters } from "./ChatParts";

describe("ChatSources", () => {
  it("заголовок статьи открывает её, а не просто написан текстом (П7)", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatSources
        label="Источник:"
        articles={[
          { slug: "ketones", title: "Как записать кетоны" },
          { slug: "weight", title: "Как записать вес" },
        ]}
        onOpen={onOpen}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Как записать вес" }));
    expect(onOpen).toHaveBeenCalledWith({
      slug: "weight",
      title: "Как записать вес",
    });
    expect(screen.getByText("Источник:")).toBeInTheDocument();
  });

  it("без статей строки нет", () => {
    const { container } = render(
      <ChatSources label="Источник:" articles={[]} onOpen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ChatStarters", () => {
  it("кнопка готового вопроса отдаёт свой ключ", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatStarters
        title="Например, спросите:"
        items={[
          { key: "seizure", label: "Как записать приступ" },
          { key: "menu", label: "Как составить меню на день" },
        ]}
        onPick={onPick}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Как составить меню на день" }),
    );
    expect(onPick).toHaveBeenCalledWith("menu");
  });

  it("когда спрашивать нельзя, кнопки недоступны", () => {
    render(
      <ChatStarters
        title="Например, спросите:"
        items={[{ key: "seizure", label: "Как записать приступ" }]}
        onPick={() => {}}
        disabled
      />,
    );
    expect(
      screen.getByRole("button", { name: "Как записать приступ" }),
    ).toBeDisabled();
  });
});

describe("ChatDayDivider", () => {
  it("печатает день", () => {
    render(<ChatDayDivider>Вчера</ChatDayDivider>);
    expect(screen.getByText("Вчера")).toBeInTheDocument();
  });
});
