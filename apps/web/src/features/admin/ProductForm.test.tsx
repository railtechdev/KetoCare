import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { ProductForm } from "./ProductForm";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

function renderForm(values: {
  kcal: number;
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProductForm
        mode="edit"
        defaultValues={{
          nameRu: "Масло сливочное",
          nameUz: "",
          nameEn: "",
          categoryId: "",
          source: "USDA",
          sourceVersion: "SR28",
          verifiedAt: "2026-01-01",
          isActive: true,
          ...values,
        }}
        categories={[]}
        pending={false}
        error={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/**
 * Ответ клиники на вопрос 1: калорийность, расходящуюся с 9 — 4 — 4 больше чем
 * на 5 ккал, «нужно предупреждать». Считает сервер (`POST /products/check`).
 */
describe("карточка продукта: проверка значений до сохранения", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показывает предупреждение сервера, не запрещая сохранить", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: [
        {
          kind: "kcal_mismatch",
          values: { declared: 717, expected: 734 },
          field: "",
        },
      ],
    });

    renderForm({ kcal: 717, fat: 81.1, protein: 0.9, carbs: 0.1, fiber: 0 });

    expect(
      await screen.findByText(adminRu.products.form.checkTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(/заявлено 717 ккал/)).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith("/api/v1/products/check", {
      body: {
        kcal_100g: 717,
        fat_100g: 81.1,
        protein_100g: 0.9,
        carbs_100g: 0.1,
        fiber_100g: 0,
      },
    });
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeEnabled();
  });

  it("незаполненную карточку сервер не спрашивает", async () => {
    (api.POST as Mock).mockResolvedValue({ data: [] });

    renderForm({ kcal: 717, fat: 81.1, protein: 0.9, carbs: 0.1, fiber: 0 });
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(adminRu.products.form.fat), {
      target: { value: "" },
    });

    // Пауза проверки — 400 мс; дольше ждать нечего: запроса не будет.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.POST).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(adminRu.products.form.checkTitle),
    ).not.toBeInTheDocument();
  });
});
