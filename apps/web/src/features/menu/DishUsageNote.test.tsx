import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { DishUsageNote } from "./DishUsageNote";

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

describe("DishUsageNote (ADR-0089)", () => {
  it("names the last day, the number of days and the last eaten day", () => {
    render(
      <DishUsageNote
        usage={{
          id: "r1",
          last_date: "2026-11-12",
          days: 2,
          last_eaten: "2026-11-10",
        }}
      />,
    );
    expect(
      screen.getByText("В меню 12 нояб., 2 дня · съедено 10 нояб."),
    ).toBeInTheDocument();
  });

  it("says nothing of eating when it was never eaten", () => {
    render(
      <DishUsageNote
        usage={{ id: "r1", last_date: "2026-11-12", days: 5, last_eaten: null }}
      />,
    );
    expect(screen.getByText("В меню 12 нояб., 5 дней")).toBeInTheDocument();
  });

  it("renders nothing for a dish never planned", () => {
    const { container } = render(<DishUsageNote usage={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
