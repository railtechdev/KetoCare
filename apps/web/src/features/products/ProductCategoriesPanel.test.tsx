import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import productsRu from "../../locales/ru/products.json";
import { ProductCategoriesPanel } from "./ProductCategoriesPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "products", productsRu, true, true);

const FATS = "11111111-1111-4111-8111-111111111111";
const EMPTY = "22222222-2222-4222-8222-222222222222";

const CATEGORIES = [
  { id: FATS, name_ru: "Жиры", sort: 0, products: 12 },
  { id: EMPTY, name_ru: "жиры", sort: 1, products: 0 },
];

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  return render(<ProductCategoriesPanel />, { wrapper: Wrapper });
}

describe("справочник категорий", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({
      data: CATEGORIES,
      error: undefined,
    });
    (api.POST as Mock).mockResolvedValue({
      data: { moved: 12 },
      error: undefined,
    });
  });

  it("показывает, сколько позиций в категории", async () => {
    // При слиянии двух одноимённых счётчик отвечает, какая из них настоящая.
    renderPanel();

    expect(await screen.findByText("Жиры")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("удаление предлагается только у пустой категории", async () => {
    // Сервер откажет и объяснит, но показывать заведомо отказную кнопку —
    // обещание того, чего нет (правило П3 канона).
    renderPanel();

    await screen.findByText("Жиры");
    expect(screen.getAllByRole("button", { name: "Удалить" })).toHaveLength(1);
  });

  it("слияние переносит позиции в выбранную категорию", async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("Жиры");
    await user.click(screen.getAllByRole("button", { name: /Слить/ })[0]!);

    await user.selectOptions(
      await screen.findByLabelText("Куда перенести"),
      EMPTY,
    );
    await user.click(screen.getByRole("button", { name: "Слить" }));

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/products/categories/{category_id}/merge",
      expect.objectContaining({ body: { into_id: EMPTY } }),
    );
  });
});
