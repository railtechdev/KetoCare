import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { SectionRouter } from "../../test/SectionRouter";
import { ProductsPanel } from "./ProductsPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "admin-1", role: "admin" } }),
}));

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const OUTSIDE_ID = "33333333-3333-4333-8333-333333333333";

const PRODUCT = {
  id: OUTSIDE_ID,
  name_ru: "Масло сливочное",
  category_id: "c1",
  kcal_100g: 748,
  fat_100g: 82.5,
  protein_100g: 0.5,
  carbs_100g: 0.8,
  fiber_100g: 0,
  source: "USDA",
  source_version: "2024",
  verified_on: "2026-01-10",
  is_active: true,
  created_at: "2026-01-10T10:00:00Z",
  updated_at: "2026-01-10T10:00:00Z",
};

function renderPanel(item?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {/* Без `item` панель показывает СПИСОК; с `item` — карточку позиции.
            Ветка выбирается в самой панели, поэтому параметр нельзя подменить
            пустой строкой: она тоже «задана». */}
        <SectionRouter
          section="products"
          search={item === undefined ? {} : { item }}
        >
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProductsPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/products/{product_id}") {
      return Promise.resolve({ data: PRODUCT });
    }
    if (path === "/api/v1/products/categories") {
      return Promise.resolve({ data: [{ id: "c1", name_ru: "Жиры" }] });
    }
    // Выборка без искомой позиции: другая страница, другой фильтр.
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
});

describe("карточка продукта вне текущей выборки", () => {
  it("дочитывается по идентификатору, а не открывает форму заведения", async () => {
    // Раньше ссылка на строку с другой страницы открывала пустую форму
    // «Новый продукт», и администратор заводил дубль вместо правки.
    renderPanel(OUTSIDE_ID);

    expect(
      await screen.findByDisplayValue("Масло сливочное"),
    ).toBeInTheDocument();
  });

  it("несуществующая позиция объясняет себя и даёт выход", async () => {
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/products/{product_id}") {
        return Promise.resolve({ error: { detail: "нет" } });
      }
      if (path === "/api/v1/products/categories") {
        return Promise.resolve({ data: [{ id: "c1", name_ru: "Жиры" }] });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    });

    renderPanel(OUTSIDE_ID);

    expect(await screen.findByText("Позиция не найдена")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "К списку продуктов" }),
    ).toBeInTheDocument();
  });
});

/**
 * «Богатые белками / жирами / углеводами» — просьба заказчицы, чтобы менять один
 * продукт на другой по роли в блюде.
 *
 * Отбирает СЕРВЕР. Это не оптимизация: страница таблицы — двадцать строк, и
 * фильтрация полученного дала бы «жировые из тех двадцати, что попали на экран».
 * Диетолог решил бы, что жировых продуктов в справочнике три.
 */
describe("отбор по ведущему макронутриенту", () => {
  it("уходит в запрос, а не применяется к полученной странице", async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByLabelText(adminRu.products.filters.macro);
    await user.selectOptions(
      screen.getByLabelText(adminRu.products.filters.macro),
      "protein",
    );

    await waitFor(() => {
      const asked = (api.GET as Mock).mock.calls.some(
        ([path, options]) =>
          path === "/api/v1/products" &&
          (options as { params: { query: Record<string, unknown> } }).params
            .query.macro === "protein",
      );
      expect(asked).toBe(true);
    });
  });

  it("по умолчанию не задан — справочник не сужается молча", async () => {
    renderPanel();

    await screen.findByLabelText(adminRu.products.filters.macro);
    const first = (api.GET as Mock).mock.calls.find(
      ([path]) => path === "/api/v1/products",
    );
    expect(
      (first?.[1] as { params: { query: Record<string, unknown> } }).params
        .query.macro,
    ).toBeUndefined();
  });

  it("правило названо у самого поля, а не спрятано в справке", async () => {
    // Диетолог должен понимать, по какому признаку отобрано: порога «богатый»
    // у нас нет, и «Жиры» без пояснения читалось бы как порог.
    renderPanel();

    expect(
      await screen.findByText(adminRu.products.filters.macroHint),
    ).toBeInTheDocument();
  });
});
