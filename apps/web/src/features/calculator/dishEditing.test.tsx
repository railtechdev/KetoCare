import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import calculatorRu from "../../locales/ru/calculator.json";
import { SectionRouter } from "../../test/SectionRouter";
import { CalculatorPage } from "./CalculatorPage";
import { incomingDish } from "./incomingItem";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DISH_ID = "22222222-2222-4222-8222-222222222222";
const COPY_ID = "33333333-3333-4333-8333-333333333333";

const DISH = {
  id: DISH_ID,
  patient_id: PATIENT_ID,
  title: "Омлет",
  ingredients: [{ product_id: "p1", grams: 60 }],
  computed: null,
  engine_version: "1.3.0",
};

const VERIFIED = {
  dish: {
    kcal: 90,
    fat_g: 6,
    protein_g: 7,
    carbs_g: 0.4,
    fiber_g: 0,
    net_carbs_g: 0.4,
    ratio: 0.8,
    engine_version: "1.3.0",
    items: [
      {
        product_id: "p1",
        grams: 60,
        kcal: 90,
        fat_g: 6,
        protein_g: 7,
        carbs_g: 0.4,
        fiber_g: 0,
        net_carbs_g: 0.4,
      },
    ],
  },
  ratio_within_tolerance: null,
  kcal_within_tolerance: null,
  excluded: [],
  uncounted_items: [],
};

function ItemProbe() {
  const search = useSearch({ from: "/app/$section" });
  return <span data-testid="item-param">{search.item ?? "—"}</span>;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter
          section="calculator"
          search={{ item: incomingDish(DISH_ID) }}
        >
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

let dishes: (typeof DISH)[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  dishes = [DISH];
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/products/{product_id}") {
      return Promise.resolve({
        data: {
          id: "p1",
          name_ru: "Яйцо куриное",
          kcal_100g: 143,
          fat_100g: 9.5,
          protein_100g: 12.6,
          carbs_100g: 0.7,
          fiber_100g: 0,
          is_active: true,
        },
      });
    }
    if (path.includes("custom-dishes")) {
      return Promise.resolve({ data: { items: dishes, total: dishes.length } });
    }
    if (path.includes("overview")) {
      return Promise.resolve({ data: { prescription: null } });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
  (api.POST as Mock).mockImplementation((path: string) => {
    if (path.includes("custom-dishes")) {
      const copy = { ...DISH, id: COPY_ID, title: "Омлет с маслом" };
      dishes.push(copy);
      return Promise.resolve({ data: copy });
    }
    return Promise.resolve({ data: VERIFIED });
  });
  (api.PUT as Mock).mockResolvedValue({ data: DISH });
});

const saveChanges = () =>
  screen.findByRole("button", { name: "Сохранить изменения" });

describe("saved dish opened in the calculator", () => {
  it("offers the dish's own title and replaces its composition", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByDisplayValue("Омлет")).toBeInTheDocument();
    const save = await saveChanges();
    await waitFor(() => expect(save).toBeEnabled(), { timeout: 3000 });

    await user.click(save);

    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    const [, options] = (api.PUT as Mock).mock.calls[0] as [
      string,
      { params: { path: { dish_id: string } }; body: unknown },
    ];
    expect(options.params.path.dish_id).toBe(DISH_ID);
    expect(options.body).toEqual({
      title: "Омлет",
      ingredients: [{ product_id: "p1", grams: 60 }],
    });
    expect(
      (api.POST as Mock).mock.calls.some(([path]) =>
        String(path).includes("custom-dishes"),
      ),
    ).toBe(false);
  });

  it("saves a copy and then shows that copy", async () => {
    const user = userEvent.setup();
    renderPage();

    const title = await screen.findByDisplayValue("Омлет");
    const asNew = await screen.findByRole("button", {
      name: "Сохранить как новое",
    });
    await waitFor(() => expect(asNew).toBeEnabled(), { timeout: 3000 });
    await user.clear(title);
    await user.type(title, "Омлет с маслом");
    await user.click(asNew);

    await waitFor(() =>
      expect(screen.getByTestId("item-param")).toHaveTextContent(
        incomingDish(COPY_ID),
      ),
    );
    expect(api.PUT).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Омлет с маслом")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
