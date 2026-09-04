import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import { SectionRouter } from "../../test/SectionRouter";
import { ProductAnomaliesPanel } from "./ProductAnomaliesPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter>{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProductAnomaliesPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("проверка базы продуктов", () => {
  it("чистая база говорит об этом прямо", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });

    renderPanel();

    expect(
      await screen.findByText(adminRu.products.anomalies.empty.title),
    ).toBeInTheDocument();
  });

  it("находка называет продукт, класс и числа", async () => {
    /* Администратор сверяет значения с источником сам: «починить» их
       автоматически нельзя — по ним считают меню ребёнка. */
    (api.GET as Mock).mockResolvedValue({
      data: {
        items: [
          {
            product_id: "11111111-1111-4111-8111-111111111111",
            name_ru: "Масло в килоджоулях",
            is_active: true,
            anomalies: [
              {
                kind: "kcal_mismatch",
                values: { declared: 3000, expected: 748 },
                field: "",
              },
            ],
          },
        ],
        total: 1,
      },
    });

    renderPanel();

    expect(await screen.findByText("Масло в килоджоулях")).toBeInTheDocument();
    expect(
      screen.getByText(adminRu.products.anomalies.kind.kcal_mismatch),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/по макронутриентам выходит 748/),
    ).toBeInTheDocument();
  });

  it("неизвестный класс находки не оставляет строку без подписи", async () => {
    /* Классы приходят кодами и появляются раньше переводов: строка без подписи
       читалась бы как пустая. */
    (api.GET as Mock).mockResolvedValue({
      data: {
        items: [
          {
            product_id: "22222222-2222-4222-8222-222222222222",
            name_ru: "Странный продукт",
            is_active: true,
            anomalies: [{ kind: "something_new", values: {}, field: "" }],
          },
        ],
        total: 1,
      },
    });

    renderPanel();

    expect(
      await screen.findByText(adminRu.products.anomalies.kind.other),
    ).toBeInTheDocument();
  });
});
