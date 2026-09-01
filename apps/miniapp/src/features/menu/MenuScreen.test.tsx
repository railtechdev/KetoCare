import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { MenuScreen } from "./MenuScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
};

function menu(overrides: Record<string, unknown> = {}) {
  return {
    id: "menu-1",
    patient_id: SESSION.patientId,
    date: "2026-08-31",
    totals: {
      kcal: 1200,
      fat: 100,
      protein: 24,
      carbs: 10,
      fiber: 3,
      ratio: 3.5,
    },
    engine_version: "1.0.0",
    items: [
      {
        id: "item-1",
        menu_id: "menu-1",
        patient_id: SESSION.patientId,
        meal_slot: "breakfast",
        recipe_id: null,
        custom_dish_id: null,
        portion_factor: 1,
        eaten: false,
        title: "Омлет на сливках",
        has_snapshot: true,
        changed_since_saved: false,
      },
    ],
    withdrawn_products: [],
    excluded_products: [],
    created_at: "2026-08-31T05:00:00Z",
    ...overrides,
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<MenuScreen session={SESSION} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({
    data: menu(),
    response: { status: 200 },
  });
  (api.POST as Mock).mockResolvedValue({ data: {}, response: { status: 200 } });
});

describe("план дня в Mini App", () => {
  it("отмечает съеденное", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("checkbox", { name: /Омлет/ }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
        expect.objectContaining({ body: { eaten: true } }),
      );
    });
  });

  it("снимает ошибочную отметку", async () => {
    // Без снятия ошибочное нажатие осталось бы в данных навсегда, а по этим
    // отметкам врач судит, выполнялся ли план.
    (api.GET as Mock).mockResolvedValue({
      data: menu({ items: [{ ...menu().items[0], eaten: true }] }),
      response: { status: 200 },
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("checkbox", { name: /Омлет/ }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: { eaten: false } }),
      );
    });
  });

  it("позиция раскрывается в «что взвесить» с граммовкой сервера", async () => {
    // Снимок отвечает, что и сколько взвесить, — прежде состав был недостижим
    // с экрана, который семья держит в руках на кухне (находка М3 аудита).
    // Граммы приходят уже на позицию (М1): клиент их не доумножает.
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        items: [
          {
            ...menu().items[0],
            ingredients: [
              { product_id: "prod-1", name_ru: "Яйцо куриное", grams: 50 },
            ],
          },
        ],
      }),
      response: { status: 200 },
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByText("Что взвесить"));

    expect(await screen.findByText("Яйцо куриное")).toBeInTheDocument();
    expect(screen.getByText("50 г")).toBeInTheDocument();
  });

  it("позиция без снимка не предлагает пустого раскрытия", async () => {
    renderScreen();

    await screen.findByText("Омлет на сливках");
    expect(screen.queryByText("Что взвесить")).not.toBeInTheDocument();
  });

  it("отсутствие плана — это состояние, а не ошибка", async () => {
    // Семья могла не планировать день; экран ошибки тут читался бы как поломка.
    (api.GET as Mock).mockResolvedValue({ response: { status: 404 } });
    renderScreen();

    expect(await screen.findByText(/плана нет/)).toBeInTheDocument();
  });

  it("называет исключённые ребёнку продукты в плане", async () => {
    // По этому плану кормят сегодня — молчать нельзя.
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        excluded_products: [
          { product_id: "p1", name_ru: "Арахис", item_ids: ["item-1"] },
        ],
      }),
      response: { status: 200 },
    });
    renderScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent("Арахис");
  });

  it("предупреждает о правке рецепта после сохранения дня", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        items: [{ ...menu().items[0], changed_since_saved: true }],
      }),
      response: { status: 200 },
    });
    renderScreen();

    expect(await screen.findByText(/Рецепт изменился/)).toBeInTheDocument();
  });
});
