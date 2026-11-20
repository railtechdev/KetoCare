import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatText } from "./ChatText";

describe("ChatText", () => {
  it("жирный печатается жирным, а не звёздочками", () => {
    const { container } = render(
      <ChatText text="**Важно:** отметку ставят в меню." />,
    );

    expect(container.querySelector("strong")).toHaveTextContent("Важно:");
    expect(container).not.toHaveTextContent("*");
  });

  it("списки — списками", () => {
    render(<ChatText text={"1. Откройте меню\n2. Нажмите «Добавить»"} />);

    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("HTML в тексте модели печатается как текст и не разбирается", () => {
    const attack =
      '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">тут</a>';
    const { container } = render(<ChatText text={attack} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it("ссылка модели — только текст, без адреса", () => {
    const { container } = render(
      <ChatText text="Откройте [настройки](https://evil.example)." />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("Откройте настройки.");
    expect(container).not.toHaveTextContent("evil.example");
  });

  it("строки абзаца разделены переносом", () => {
    const { container } = render(<ChatText text={"первая\nвторая"} />);

    expect(container.querySelectorAll("br")).toHaveLength(1);
  });
});
