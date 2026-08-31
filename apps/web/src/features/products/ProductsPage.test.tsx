import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import productsRu from "../../locales/ru/products.json";
import { SectionRouter } from "../../test/SectionRouter";
import { ProductsPage } from "./ProductsPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "products", productsRu, true, true);

const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

function product(index: number, ratio: number | null) {
  return {
    id: `1111${index}`.padEnd(36, "0"),
    name_ru: `Продукт ${index}`,
    name_uz: null,
    name_en: null,
    category_id: CATEGORY_ID,
    kcal_100g: 700,
    fat_100g: 80,
    protein_100g: 1,
    carbs_100g: 1,
    fiber_100g: 0,
    ratio,
    source: "USDA",
    source_version: "SR Legacy",
    verified_at: "2026-01-01",
    is_active: true,
  };
}

/** Сервер отдаёт одну страницу из трёх тысяч позиций. */
const TOTAL = 3000;

let lastQuery: Record<string, unknown> = {};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="products">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }

  return render(<ProductsPage />, { wrapper: Wrapper });
}

describe("справочник продуктов", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQuery = {};
    (api.GET as Mock).mockImplementation(
      async (path: string, init: unknown) => {
        if (path === "/api/v1/products/categories") {
          return {
            data: [{ id: CATEGORY_ID, name_ru: "Жиры", sort: 0 }],
            error: undefined,
          };
        }
        lastQuery =
          (init as { params?: { query?: Record<string, unknown> } })?.params
            ?.query ?? {};
        return {
          data: {
            items: [product(1, 40), product(2, null)],
            total: TOTAL,
          },
          error: undefined,
        };
      },
    );
  });

  it("не выдаёт первую страницу за весь справочник", async () => {
    // Клиентская постраничность делила первые 200 строк и молчала об
    // остальных: человек видел «страница 10 из 10» и был уверен, что дочитал
    // справочник до конца.
    renderPage();

    expect(await screen.findByText("Продукт 1")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("из 150");
  });

  it("листает страницы запросом к серверу", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Продукт 1");
    await user.click(screen.getByRole("button", { name: "Вперёд" }));

    expect(lastQuery.offset).toBe(20);
  });

  it("фильтрует по категории и начинает с первой страницы", async () => {
    // Фильтра по категории у семьи не было вовсе: найти «все жиры» можно было
    // только перебором названий.
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Продукт 1");
    await user.click(screen.getByRole("button", { name: "Вперёд" }));
    await user.selectOptions(screen.getByLabelText("Категория"), CATEGORY_ID);

    expect(lastQuery.category_id).toBe(CATEGORY_ID);
    // Иначе выдача из двух строк открылась бы на седьмой странице — пустой.
    expect(lastQuery.offset).toBe(0);
  });

  it("показывает соотношение сервера и не выдумывает его у чистого жира", async () => {
    renderPage();

    await screen.findByText("Продукт 1");
    // Ядро отвечает «соотношения нет», когда знаменатель равен нулю; интерфейс
    // не превращает это в «Infinity».
    expect(screen.getByText("40.0 : 1")).toBeInTheDocument();
    expect(screen.getByText("нет")).toBeInTheDocument();
  });
});
