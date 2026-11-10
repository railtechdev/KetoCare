import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import productsRu from "../../locales/ru/products.json";
import { MenuTemplatesSheet } from "./MenuTemplatesSheet";
import type { FoodStandard } from "./useFoodStandards";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "products", productsRu, true, true);

const STANDARD = {
  id: "s1",
  name: "Детский сад",
  diet_type: "general",
} as FoodStandard;

const TEMPLATE = {
  id: "t1",
  standard_id: "s1",
  title: "Детский сад, 4 ч, весна",
  season: "весна",
  cycle_days: 2,
  status: "draft",
  source_ref: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) =>
    Promise.resolve({
      data: path.includes("{standard_id}")
        ? [TEMPLATE]
        : {
            template: TEMPLATE,
            diet_type: "general",
            items: [
              {
                cycle_day: 1,
                meal_index: 1,
                dish_title: "Омлет",
                recipe_id: "r1",
                kcal: 190,
                ratio: 0.5,
              },
              {
                cycle_day: 1,
                meal_index: 3,
                dish_title: "Мастава",
                recipe_id: null,
                kcal: null,
                ratio: null,
              },
            ],
          },
    }),
  );
});

function renderSheet() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MenuTemplatesSheet standard={STANDARD} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("шаблоны меню стандарта", () => {
  it("предупреждает, что меню не кетогенное", async () => {
    renderSheet();

    expect(await screen.findByText(/не кетогенное/)).toBeInTheDocument();
  });

  it("показывает дни и честно говорит, где чисел нет", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(
      await screen.findByRole("button", { name: TEMPLATE.title }),
    );

    expect(await screen.findByText("Омлет")).toBeInTheDocument();
    expect(screen.getByText("190 ккал")).toBeInTheDocument();
    expect(screen.getByText("Мастава")).toBeInTheDocument();
    expect(screen.getByText("нет надёжных значений")).toBeInTheDocument();
  });
});
