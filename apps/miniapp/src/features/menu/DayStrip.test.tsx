import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import ru from "../../locales/ru/app.json";
import uz from "../../locales/uz/app.json";
import { DayStrip } from "./DayStrip";
import { MENU_DAYS } from "./planDays";
import { horizontalShift } from "./stripScroll";
import { dayAt } from "./useMenu";

afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("полоса дней", () => {
  it("прокручивает только себя, а не страницу", () => {
    // Полоса стоит последним блоком карточки рецепта. `scrollIntoView`
    // двигает все прокручиваемые предки, окно тоже, и карточка открывалась
    // прокрученной к «Добавить в меню» мимо названия и состава.
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    const windowScroll = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    // Полоса 0…300 px, выбранная кнопка ушла вправо до 380 px.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return (
          this.getAttribute("aria-pressed") === "true"
            ? { left: 316, right: 380 }
            : { left: 0, right: 300 }
        ) as DOMRect;
      },
    );

    render(
      <DayStrip
        label="День"
        offsets={MENU_DAYS}
        value={5}
        onChange={() => {}}
      />,
    );

    expect(intoView).not.toHaveBeenCalled();
    expect(windowScroll).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "День" }).scrollLeft).toBe(80);
  });

  it("сдвиг — до ближнего края, а видимую кнопку не трогает", () => {
    const strip = { left: 0, right: 300 };
    expect(horizontalShift(strip, { left: 10, right: 74 })).toBe(0);
    expect(horizontalShift(strip, { left: -40, right: 24 })).toBe(-40);
    expect(horizontalShift(strip, { left: 260, right: 324 })).toBe(24);
  });

  it("точка объяснена строкой на экране, когда она есть", () => {
    const { rerender } = render(
      <DayStrip
        label="День"
        offsets={MENU_DAYS}
        value={0}
        onChange={() => {}}
        menuDates={new Set()}
      />,
    );
    expect(screen.queryByText(ru.menu.week.legend)).toBeNull();

    rerender(
      <DayStrip
        label="День"
        offsets={MENU_DAYS}
        value={0}
        onChange={() => {}}
        menuDates={new Set([dayAt(2)])}
      />,
    );
    expect(screen.getByText(ru.menu.week.legend)).toBeVisible();
  });

  it("строка-пояснение переведена на узбекский", () => {
    expect(typeof uz.menu.week.legend).toBe("string");
  });
});
