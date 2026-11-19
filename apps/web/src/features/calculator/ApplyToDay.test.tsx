import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import calculatorRu from "../../locales/ru/calculator.json";
import menuRu from "../../locales/ru/menu.json";
import type { MenuItemRead } from "../menu/useMenu";
import { ApplyToDay, type SavedDish } from "./ApplyToDay";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);
i18n.addResourceBundle("ru", "menu", menuRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";

function item(overrides: Partial<MenuItemRead>): MenuItemRead {
  return {
    id: ITEM_ID,
    menu_id: "m1",
    patient_id: PATIENT_ID,
    meal_index: 2,
    recipe_id: null,
    custom_dish_id: "d1",
    portion_factor: 1,
    eaten: false,
    title: "Омлет",
    has_snapshot: true,
    changed_since_saved: false,
    ingredients: [],
    instructions: null,
    ...overrides,
  };
}

function renderBlock(target: MenuItemRead, saved: SavedDish | null) {
  (api.GET as Mock).mockResolvedValue({
    data: { date: "2026-11-20", items: [target] },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onApplied = vi.fn();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(
    <ApplyToDay
      patientId={PATIENT_ID}
      date="2026-11-20"
      menuItemId={ITEM_ID}
      saved={saved}
      onApplied={onApplied}
    />,
    { wrapper: Wrapper },
  );
  return { onApplied };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.POST as Mock).mockResolvedValue({
    data: { date: "2026-11-20", items: [] },
  });
});

describe("ApplyToDay (ADR-0091)", () => {
  it("names the day and waits for the save", async () => {
    renderBlock(item({}), null);

    expect(
      await screen.findByRole("heading", { name: /Приём 2/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Сохраните правку/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Применить в этот день" }),
    ).toBeNull();
  });

  it("refreshes the same child's dish in the day", async () => {
    const user = userEvent.setup();
    const { onApplied } = renderBlock(item({}), {
      id: "d1",
      sourceRecipeId: null,
    });

    await user.click(
      await screen.findByRole("button", { name: "Применить в этот день" }),
    );

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const [path, options] = (api.POST as Mock).mock.calls[0]!;
    expect(path).toBe(
      "/api/v1/patients/{patient_id}/menus/items/{item_id}/refresh",
    );
    expect(options.params.path.item_id).toBe(ITEM_ID);
    expect(options.body).toBeUndefined();
  });

  it("puts the copy fitted from the day's recipe in its place", async () => {
    const user = userEvent.setup();
    renderBlock(item({ custom_dish_id: null, recipe_id: "r1" }), {
      id: "d2",
      sourceRecipeId: "r1",
    });

    await user.click(
      await screen.findByRole("button", { name: "Применить в этот день" }),
    );

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect((api.POST as Mock).mock.calls[0]![1].body).toEqual({
      custom_dish_id: "d2",
    });
  });

  it("does not offer a swap for a recipe at another portion", async () => {
    renderBlock(
      item({ custom_dish_id: null, recipe_id: "r1", portion_factor: 2 }),
      { id: "d2", sourceRecipeId: "r1" },
    );

    expect(await screen.findByText(/не одной порцией/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Применить в этот день" }),
    ).toBeNull();
  });

  it("offers nothing for a dish unrelated to the day's item", async () => {
    renderBlock(item({ custom_dish_id: "d1" }), {
      id: "d3",
      sourceRecipeId: null,
    });

    expect(
      await screen.findByText(/Сохранено отдельным блюдом/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Применить в этот день" }),
    ).toBeNull();
  });

  it("does not touch an eaten item", async () => {
    renderBlock(item({ eaten: true }), { id: "d1", sourceRecipeId: null });

    expect(await screen.findByText(/отмечено съеденным/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Применить в этот день" }),
    ).toBeNull();
  });
});
