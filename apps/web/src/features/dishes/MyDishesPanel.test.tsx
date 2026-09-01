import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import recipesRu from "../../locales/ru/recipes.json";
import { SectionRouter } from "../../test/SectionRouter";
import { MyDishesPanel } from "./MyDishesPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

const DISH = {
  id: "d1",
  patient_id: PATIENT_ID,
  title: "Завтрак с авокадо",
  ingredients: [{ product_id: "p1", grams: 40 }],
  computed: { kcal: 320, fat: 30, protein: 4, carbs: 3, fiber: 2, ratio: 4.3 },
  engine_version: "0.3.0",
  created_at: "2026-08-20T08:00:00Z",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {/* Список ведёт в калькулятор ссылкой — значит экрану нужен роутер,
            как и в работающем приложении. */}
        <SectionRouter section="recipes">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<MyDishesPanel patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({ data: { items: [DISH], total: 1 } });
  (api.PUT as Mock).mockResolvedValue({ data: DISH });
  (api.DELETE as Mock).mockResolvedValue({ error: undefined });
});

describe("мои блюда", () => {
  it("показывает сохранённые блюда с их показателями", async () => {
    // Форма сохранения обещала список; списка не было ни одним экраном.
    renderPanel();

    expect(await screen.findByText("Завтрак с авокадо")).toBeInTheDocument();
    expect(screen.getByText("320 ккал")).toBeInTheDocument();
  });

  it("переименовывает блюдо, не трогая состав", async () => {
    // Ручка принимает блюдо целиком: отправить одно название значило бы
    // стереть раскладку.
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /Переименовать/ }),
    );
    const field = await screen.findByLabelText("Название");
    await user.clear(field);
    await user.type(field, "Завтрак с маслом");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(api.PUT).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/custom-dishes/{dish_id}",
        expect.objectContaining({
          body: { title: "Завтрак с маслом", ingredients: DISH.ingredients },
        }),
      );
    });
  });

  it("удаляет только после подтверждения, называющего блюдо", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /Удалить «/ }));

    expect(
      await screen.findByText(/Удалить блюдо «Завтрак с авокадо»\?/),
    ).toBeInTheDocument();
    expect(api.DELETE).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => {
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/custom-dishes/{dish_id}",
        expect.objectContaining({
          params: { path: { patient_id: PATIENT_ID, dish_id: "d1" } },
        }),
      );
    });
  });

  it("пустой список объясняет, откуда берутся блюда", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderPanel();

    expect(await screen.findByText("Своих блюд пока нет")).toBeInTheDocument();
    expect(screen.getByText(/калькуляторе/)).toBeInTheDocument();
  });
});
