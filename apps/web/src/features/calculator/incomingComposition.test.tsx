import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import calculatorRu from "../../locales/ru/calculator.json";
import { useSearch } from "@tanstack/react-router";

import { SectionRouter } from "../../test/SectionRouter";
import { CalculatorPage } from "./CalculatorPage";

/** Показывает `?item=` из адреса: тест смотрит на него, а не на догадки. */
function ItemProbe() {
  const search = useSearch({ from: "/app/$section" });
  return <span data-testid="item-param">{search.item ?? "—"}</span>;
}
import { incomingRecipe } from "./incomingDish";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE_ID = "22222222-2222-4222-8222-222222222222";

const RECIPE = {
  id: RECIPE_ID,
  title: "Омлет на сливках",
  category: "breakfast",
  photo_path: null,
  yield_g: 180,
  servings: 1,
  instructions: "Взбить.",
  status: "published",
  computed: null,
  per_portion: null,
  engine_version: null,
  author_id: "a1",
  ingredients: [
    { product_id: "p1", grams: 60, position: 0 },
    { product_id: "p2", grams: 30, position: 1 },
  ],
  created_at: "2026-08-01T10:00:00Z",
};

const PRODUCTS: Record<string, Record<string, unknown>> = {
  p1: {
    id: "p1",
    name_ru: "Яйцо куриное",
    kcal_100g: 143,
    fat_100g: 9.5,
    protein_100g: 12.6,
    carbs_100g: 0.7,
    fiber_100g: 0,
    is_active: true,
  },
  p2: {
    id: "p2",
    name_ru: "Сливки 33%",
    kcal_100g: 322,
    fat_100g: 33,
    protein_100g: 2.2,
    carbs_100g: 3.1,
    fiber_100g: 0,
    is_active: true,
  },
};

function renderPage(item: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator" search={{ item, tab: "scale" }}>
          {children}
          <ItemProbe />
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<CalculatorPage patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(
    (path: string, options: { params?: { path?: Record<string, string> } }) => {
      if (path === "/api/v1/recipes/{recipe_id}") {
        return Promise.resolve({ data: RECIPE });
      }
      if (path === "/api/v1/products/{product_id}") {
        const id = options.params?.path?.product_id ?? "";
        return Promise.resolve({ data: PRODUCTS[id] });
      }
      if (path.includes("overview")) {
        return Promise.resolve({
          data: {
            patient_id: PATIENT_ID,
            date: "2026-09-01",
            prescription: null,
            day: null,
            last_ketone: null,
            last_weight: null,
            seizures_today: { entries: 0, count: 0 },
          },
        });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    },
  );
});

describe("рецепт приходит в калькулятор составом", () => {
  it("состав заполняется сам, а не набирается руками", async () => {
    // «Пересчитать готовое блюдо» начиналось с набора состава заново: вкладка
    // не давала ничего сверх «Проверить».
    renderPage(incomingRecipe(RECIPE_ID));

    expect(await screen.findByText("Яйцо куриное")).toBeInTheDocument();
    expect(screen.getByText("Сливки 33%")).toBeInTheDocument();
  });

  it("граммовка приходит из рецепта, а не подставляется по умолчанию", async () => {
    renderPage(incomingRecipe(RECIPE_ID));

    await screen.findByText("Яйцо куриное");
    expect(await screen.findByDisplayValue("60")).toBeInTheDocument();
    expect(screen.getByDisplayValue("30")).toBeInTheDocument();
  });
});

describe("ссылка на блюдо остаётся в адресе", () => {
  it("параметр не снимается: иначе состав исчезает вместе с адресом", async () => {
    // Сначала он снимался, как у одиночного продукта, — и на живом экране это
    // стирало весь состав: смена адреса перемонтирует раздел, а строки живут в
    // его состоянии. Замечено в браузере.
    renderPage(incomingRecipe(RECIPE_ID));

    await screen.findByText("Яйцо куриное");
    expect(screen.getByTestId("item-param")).toHaveTextContent(
      incomingRecipe(RECIPE_ID),
    );
  });
});
