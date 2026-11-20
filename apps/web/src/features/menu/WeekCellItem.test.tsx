import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { PatientRouter } from "../../test/PatientRouter";
import type { MenuItemRead } from "./useMenu";
import { WeekCellItem } from "./WeekCellItem";

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
    // The day it came from goes along: the calculator offers to apply the
    // saved correction there (ADR-0091).
    expect(link.getAttribute("href")).toContain("menuItem=i1");
    expect(link.getAttribute("href")).toMatch(/date=\d{4}-\d{2}-\d{2}/);
  });

  it("opens a library recipe the same way", async () => {
    const user = userEvent.setup();
    renderItem(item({ custom_dish_id: null, recipe_id: "r1" }));

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    const link = await screen.findByRole("link", { name: "Открыть блюдо" });
    expect(link.getAttribute("href")).toContain("item=recipe%3Ar1");
  });

  it("offers the new composition when the dish changed since (ADR-0089)", async () => {
    const user = userEvent.setup();
    (api.POST as Mock).mockResolvedValue({
      data: { date: "2026-11-16", items: [] },
    });
    renderItem(item({ changed_since_saved: true }));

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    expect(
      await screen.findByText(/в дне пока прежние граммы/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Взять новый состав" }),
    );

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect((api.POST as Mock).mock.calls[0]![0]).toBe(
      "/api/v1/patients/{patient_id}/menus/items/{item_id}/refresh",
    );
    expect((api.POST as Mock).mock.calls[0]![1].params.path.item_id).toBe("i1");
  });

  it("does not offer it for an eaten item", async () => {
    const user = userEvent.setup();
    renderItem(item({ changed_since_saved: true, eaten: true }));

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    await screen.findByRole("link", { name: "Открыть блюдо" });
    expect(
      screen.queryByRole("button", { name: "Взять новый состав" }),
    ).toBeNull();
  });
});
