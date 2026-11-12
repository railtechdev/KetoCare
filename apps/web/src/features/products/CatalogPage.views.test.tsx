import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import productsRu from "../../locales/ru/products.json";
import type { SectionSearch } from "../../routes/search";
import { currentAddress } from "../../test/address";
import { SectionRouter } from "../../test/SectionRouter";
import { CatalogPage } from "./CatalogPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "d-1", role: "dietitian" } }),
}));

i18n.addResourceBundle("ru", "admin", adminRu, true, true);
i18n.addResourceBundle("ru", "products", productsRu, true, true);

const ANOMALY = {
  product_id: "2b1a0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d",
  name_ru: "Масло в килоджоулях",
  is_active: true,
  anomalies: [
    { kind: "kcal_mismatch", values: { declared: 3000, expected: 734 } },
  ],
};

function renderPage(search: SectionSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="products" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<CatalogPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/products/anomalies")
      return Promise.resolve({ data: { items: [ANOMALY], total: 1 } });
    if (path === "/api/v1/food-standards") return Promise.resolve({ data: [] });
    if (path === "/api/v1/products/categories")
      return Promise.resolve({ data: [] });
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
});

describe("справочник продуктов: проверка значений (ADR-0073)", () => {
  it("диетолог открывает проверку вкладкой, и вкладка живёт в адресе", async () => {
    // Проверка стояла только у администратора, у которого раздела продуктов
    // нет в меню: её не видел никто из тех, кто правит значения.
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("radio", {
        name: adminRu.products.anomalies.title,
      }),
    );

    expect(await screen.findByText(ANOMALY.name_ru)).toBeInTheDocument();
    expect(currentAddress()).toMatchObject({ tab: "anomalies" });
  });

  it("строка проверки ведёт в карточку и обратно на проверку", async () => {
    renderPage({ tab: "anomalies" });

    const link = await screen.findByRole("link", { name: ANOMALY.name_ru });
    const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(href.searchParams.get("item")).toBe(ANOMALY.product_id);
    expect(href.searchParams.get("tab")).toBe("anomalies");
    expect(
      within(link.closest("li") as HTMLElement).getByText(
        adminRu.products.anomalies.kind.kcal_mismatch,
      ),
    ).toBeInTheDocument();
  });
});
