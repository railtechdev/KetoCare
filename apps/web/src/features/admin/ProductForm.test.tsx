import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { ProductForm } from "./ProductForm";
import { valueControl } from "../../test/nativeSelect";

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

    renderForm({
      kcal: 7.17,
      fat: 0.811,
      protein: 0.009,
      carbs: 0.001,
      fiber: 0,
    });

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

    renderForm({
      kcal: 7.17,
      fat: 0.811,
      protein: 0.009,
      carbs: 0.001,
      fiber: 0,
    });
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

describe("карточка продукта: приправа (ADR-0054)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.POST as Mock).mockResolvedValue({ data: [] });
  });

  it("отметка снята по умолчанию и объясняет, что значит", async () => {
    renderForm({ kcal: 0, fat: 0, protein: 0, carbs: 0, fiber: 0 });

    const seasoning = screen.getByRole("checkbox", {
      name: adminRu.products.form.seasoning,
    });
    expect(seasoning).not.toBeChecked();
    // Пояснение связано с флажком: читающий с экрана слышит его вместе с ним.
    expect(seasoning).toHaveAccessibleDescription(
      adminRu.products.form.seasoningHint,
    );
    await waitFor(() => expect(api.POST).toHaveBeenCalled());
  });
});

describe("карточка продукта: контроль калорийности по формуле Этуотера", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.POST as Mock).mockResolvedValue({ data: [] });
  });

  it("показывает предупреждение при расхождении БЖУ и позволяет подставить расчётную калорийность", async () => {
    // 10*4 + 20*9 + 30*4 = 340 ккал. Задаём kcal = 100 (расхождение 240 ккал).
    renderForm({ kcal: 1, fat: 0.2, protein: 0.1, carbs: 0.3, fiber: 0 });

    expect(
      screen.getByText(adminRu.products.form.atwaterTitle),
    ).toBeInTheDocument();

    const substituteButton = screen.getByRole("button", {
      name: /340/,
    });
    expect(substituteButton).toBeInTheDocument();

    fireEvent.click(substituteButton);

    const kcalInput = screen.getByLabelText(adminRu.products.form.kcal);
    expect(valueControl(kcalInput)).toHaveValue(3.4);

    // После подстановки расхождение устранено — баннер исчезает
    expect(
      screen.queryByText(adminRu.products.form.atwaterTitle),
    ).not.toBeInTheDocument();
  });

  it("не показывает ложное предупреждение для низкокалорийной зелени (огурцы/салат) при разнице <= 15 ккал", async () => {
    // Огурцы: белки 0.8г, жиры 0.1г, углеводы 2.5г -> по Этуотеру 14.1 ккал (~14 ккал).
    // Заявленная калорийность 16 ккал. Относительное расхождение 13.5% (> 10%), но разница всего 1.9 ккал (<= 15 ккал).
    // По логическому «И» предупреждение не должно срабатывать.
    renderForm({
      kcal: 0.16,
      fat: 0.001,
      protein: 0.008,
      carbs: 0.025,
      fiber: 0.005,
    });

    expect(
      screen.queryByText(adminRu.products.form.atwaterTitle),
    ).not.toBeInTheDocument();
  });
});

describe("карточка продукта: прочерк источника (ADR-0067)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.POST as Mock).mockResolvedValue({ data: [] });
  });

  it("помечает поле «нет данных» и даёт подтвердить ноль", async () => {
    const onSubmit = vi.fn();
    const categoryId = "6f1e5c34-9b7a-4c2d-8f10-2a3b4c5d6e7f";
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProductForm
          mode="derive"
          defaultValues={{
            nameRu: "Говядина I категории",
            nameUz: "",
            nameEn: "",
            categoryId,
            kcal: 2.18,
            fat: 0.07,
            protein: 0.189,
            carbs: 0,
            fiber: 0,
            source: "Минздрав РУз",
            sourceVersion: "действующая редакция",
            verifiedAt: "2026-11-11",
            isActive: true,
            seasoning: false,
          }}
          categories={[
            { id: categoryId, name_ru: "Белковые", sort: 0, products: 1 },
          ]}
          unknownNutrients={["carbs"]}
          pending={false}
          error={null}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(adminRu.products.form.noData)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(adminRu.products.form.confirmValue));
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0].confirmed.carbs).toBe(true);
  });
});
