import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { PatientRouter } from "../../test/PatientRouter";
import type { MenuItemRead } from "./useMenu";
import { WeekCellItem } from "./WeekCellItem";
import { WeekPrint } from "./WeekGrid";
import type { MenuWeek } from "./useWeek";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<MenuItemRead>): MenuItemRead {
  return {
    id: "i1",
    menu_id: "m1",
    patient_id: PATIENT_ID,
    meal_index: 1,
    recipe_id: null,
    custom_dish_id: "d1",
    portion_factor: 1,
    eaten: false,
    title: "Омлет",
    has_snapshot: true,
    changed_since_saved: false,
    ingredients: [
      {
        product_id: "p1",
        name_ru: "Яйцо куриное",
        grams: 40,
        counts_in_calculation: true,
      },
      {
        product_id: "p2",
        name_ru: "Сливки 36%",
        grams: 52,
        counts_in_calculation: true,
      },
    ],
    instructions: "Взбить яйца со сливками.\nЗапечь 15 минут.",
    ...overrides,
  };
}

function weekOf(items: MenuItemRead[]): MenuWeek {
  return {
    start: "2026-11-16",
    days: [
      {
        date: "2026-11-16",
        menu: {
          totals: {
            kcal: 1380,
            fat: 120,
            protein: 23,
            carbs: 17,
            fiber: 2,
            ratio: 3,
          },
          items,
          excluded_products: [],
        },
      },
      { date: "2026-11-17", menu: null },
    ],
  } as unknown as MenuWeek;
}

describe("printed week (ADR-0088)", () => {
  it("prints each dish as a table with its steps under it", () => {
    render(
      <WeekPrint
        patientName="Пациент"
        week={weekOf([
          item({ meal_index: 2, id: "i2", title: "Суп", instructions: null }),
          item({}),
        ])}
      />,
    );

    const dishes = screen.getAllByRole("article");
    // Приёмы по порядку, а не в порядке записи.
    expect(within(dishes[0]!).getByRole("heading")).toHaveTextContent(
      "Приём 1. Омлет",
    );
    expect(within(dishes[1]!).getByRole("heading")).toHaveTextContent(
      "Приём 2. Суп",
    );

    const rows = within(dishes[0]!).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Яйцо куриное");
    expect(rows[1]).toHaveTextContent("40 г");
    expect(within(dishes[0]!).getByText("Приготовление")).toBeInTheDocument();
    expect(within(dishes[0]!).getByText(/Запечь 15 минут/)).toBeInTheDocument();
    // Без шагов раздела «Приготовление» нет вовсе — пустой заголовок на бумаге
    // читался бы как потерянный текст.
    expect(within(dishes[1]!).queryByText("Приготовление")).toBeNull();
  });

  it("names the day's ratio, calories and macros under its date", () => {
    render(<WeekPrint patientName="Пациент" week={weekOf([item({})])} />);

    expect(screen.getByText(/3\.0 : 1/)).toHaveTextContent("1 380 ккал");
    expect(screen.getByText(/белки 23,0 г/)).toBeInTheDocument();
    // Пустой день не печатается.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("week cell item", () => {
  function renderItem(target: MenuItemRead) {
    const client = new QueryClient();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <PatientRouter patientId={PATIENT_ID} view="menu">
            {children}
          </PatientRouter>
        </QueryClientProvider>
      );
    }
    return render(
      <WeekCellItem
        patientId={PATIENT_ID}
        date="2026-11-16"
        dayLabel="пн, 16 ноября"
        item={target}
        dayItems={[target, item({ id: "i9" })]}
      />,
      { wrapper: Wrapper },
    );
  }

  it("opens the child's dish in the card's calculator", async () => {
    const user = userEvent.setup();
    renderItem(item({}));

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    const link = await screen.findByRole("link", { name: "Открыть блюдо" });
    expect(link.getAttribute("href")).toContain(
      `/app/patients/${PATIENT_ID}/calculator`,
    );
    expect(link.getAttribute("href")).toContain("item=dish%3Ad1");
  });

  it("opens a library recipe the same way", async () => {
    const user = userEvent.setup();
    renderItem(item({ custom_dish_id: null, recipe_id: "r1" }));

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    const link = await screen.findByRole("link", { name: "Открыть блюдо" });
    expect(link.getAttribute("href")).toContain("item=recipe%3Ar1");
  });

  it("says the day keeps its numbers when the dish changed since", async () => {
    const user = userEvent.setup();
    renderItem(item({ changed_since_saved: true }));

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    expect(
      await screen.findByText(/Числа этого дня остались прежними/),
    ).toBeInTheDocument();
  });
});
