import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import calculatorRu from "../../locales/ru/calculator.json";
import { SectionRouter } from "../../test/SectionRouter";
import { CalculatorPage } from "./CalculatorPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const PRODUCT = {
  id: PRODUCT_ID,
  name_ru: "Кокосовое масло",
  kcal_100g: 899,
  fat_100g: 99.9,
  protein_100g: 0,
  carbs_100g: 0,
  fiber_100g: 0,
};

function renderWithItem(item?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator" search={item ? { item } : {}}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }

  return render(<CalculatorPage patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

/**
 * Справочник и калькулятор не знали друг о друге: найденный в справочнике
 * продукт нельзя было взять в расчёт — его приходилось искать в калькуляторе
 * заново, по памяти. Теперь справочник передаёт его через `?item=<id>`.
 */
describe("продукт из справочника", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("{product_id}")
        ? { data: PRODUCT, error: undefined }
        : { data: { items: [], total: 0 }, error: undefined },
    );
  });

  it("попадает в состав блюда", async () => {
    renderWithItem(PRODUCT_ID);

    expect(await screen.findByText("Кокосовое масло")).toBeInTheDocument();
  });

  it("без параметра состав остаётся пустым", async () => {
    renderWithItem();

    expect(await screen.findByText(/Состав пока пустой/)).toBeInTheDocument();
    expect(api.GET).not.toHaveBeenCalledWith(
      "/api/v1/products/{product_id}",
      expect.anything(),
    );
  });
});

describe("блюдо из рецепта", () => {
  beforeEach(() => vi.clearAllMocks());

  it("пока состав дочитывается — скелетон, при отказе — ошибка с повтором", async () => {
    // Прежде экран молчал и при загрузке, и при отказе: человек пришёл
    // пересчитать блюдо и видел пустой состав без объяснений.
    let failRecipe = true;
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/recipes/{recipe_id}") {
        return failRecipe
          ? { data: undefined, error: { error: { code: "internal" } } }
          : {
              data: {
                id: "r1",
                ingredients: [{ product_id: PRODUCT_ID, grams: 30 }],
              },
              error: undefined,
            };
      }
      if (path.includes("{product_id}")) {
        return { data: PRODUCT, error: undefined };
      }
      return { data: { items: [], total: 0 }, error: undefined };
    });
    const user = userEvent.setup();
    renderWithItem("recipe:r1");

    expect(
      await screen.findByText(calculatorRu.incoming.errorTitle),
    ).toBeInTheDocument();

    failRecipe = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    expect(await screen.findByText("Кокосовое масло")).toBeInTheDocument();
    expect(screen.queryByText(calculatorRu.incoming.errorTitle)).toBeNull();
  });
});
