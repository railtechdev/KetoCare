import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { CalculatorScreen } from "./CalculatorScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
};

const PRODUCT = {
  id: "p1",
  name_ru: "Масло сливочное",
  kcal_100g: 748,
  fat_100g: 82.5,
  protein_100g: 0.5,
  carbs_100g: 0.8,
  fiber_100g: 0,
  is_active: true,
};

function verifyResponse(overrides: Record<string, unknown> = {}) {
  return {
    dish: {
      items: [{ product_id: "p1", grams: 30 }],
      kcal: 224,
      fat_g: 24.8,
      protein_g: 0.2,
      carbs_g: 0.2,
      fiber_g: 0,
      ratio: 3.9,
      engine_version: "1.0.0",
    },
    ratio_within_tolerance: true,
    kcal_within_tolerance: true,
    excluded: [],
    ...overrides,
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<CalculatorScreen session={SESSION} />, { wrapper: Wrapper });
}

async function addProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Найдите продукт"), "масло");
  await user.click(
    await screen.findByRole("button", { name: "Масло сливочное" }),
  );
  await user.type(
    await screen.findByLabelText(/Масло сливочное, граммы/),
    "30",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("overview")) {
      return Promise.resolve({
        data: {
          patient_id: SESSION.patientId,
          date: "2026-08-31",
          prescription: {
            ratio: 3.5,
            kcal_per_day: 1200,
            protein_g: 24,
            carbs_limit_g: 10,
          },
          day: null,
          last_ketone: null,
          last_weight: null,
          seizures_today: { entries: 0, count: 0 },
        },
      });
    }
    return Promise.resolve({ data: { items: [PRODUCT], total: 1 } });
  });
  (api.POST as Mock).mockResolvedValue({ data: verifyResponse() });
});

describe("калькулятор в Mini App", () => {
  it("считает по назначению ребёнка, а не по зашитой четвёрке", async () => {
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await user.type(screen.getByLabelText("Ккал на приём"), "300");

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/verify",
        expect.objectContaining({
          body: expect.objectContaining({
            patient_id: SESSION.patientId,
            targets: expect.objectContaining({ ratio: 3.5, kcal: 300 }),
          }),
        }),
      );
    });
  });

  it("считает и без целей — но тогда не выносит вердикта", async () => {
    // «Всё хорошо» без сравнения — утверждение из воздуха.
    (api.POST as Mock).mockResolvedValue({
      data: verifyResponse({
        ratio_within_tolerance: null,
        kcal_within_tolerance: null,
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);

    expect(
      await screen.findByText(/Укажите калорийность приёма/),
    ).toBeInTheDocument();
  });

  it("исключённый ребёнку продукт назван прямо в результате", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: verifyResponse({
        excluded: [{ product_id: "p1", name_ru: "Арахис" }],
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);

    expect(await screen.findByText("Арахис")).toBeInTheDocument();
  });

  it("исключённый продукт без имени назван словами, а не идентификатором", async () => {
    // Продукт могли удалить из справочника; 36 знаков UUID семье не говорят
    // ничего (находка М6, тот же класс, что Н1 кабинета).
    (api.POST as Mock).mockResolvedValue({
      data: verifyResponse({
        excluded: [{ product_id: "0f9b7c33-1111-4111-8111-222222222222" }],
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);

    expect(
      await screen.findByText(/продукт удалён из справочника/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0f9b7c33/)).not.toBeInTheDocument();
  });

  it("расхождение с назначением показано, а не спрятано", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: verifyResponse({
        ratio_within_tolerance: false,
        kcal_within_tolerance: true,
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await user.type(screen.getByLabelText("Ккал на приём"), "300");

    expect(
      await screen.findByText(/Кетосоотношение вне допуска/),
    ).toBeInTheDocument();
  });

  it("блюдо без белка и углеводов не выдаётся за «0.0 : 1»", async () => {
    // Соотношение приходит пустым, когда делить не на что — например, в блюде
    // из одного масла. «0.0 : 1» означало бы блюдо без жира, то есть ровно
    // противоположное тому, что на весах. Замечено на живом экране.
    (api.POST as Mock).mockResolvedValue({
      data: verifyResponse({
        dish: { ...verifyResponse().dish, ratio: null },
        ratio_within_tolerance: null,
        kcal_within_tolerance: null,
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);

    expect(
      await screen.findByLabelText("Соотношение не определено"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0\.0/)).not.toBeInTheDocument();
  });

  it("запятая в граммовке считается, а не глушит расчёт", async () => {
    // Русская клавиатура телефона в числовом режиме даёт запятую: «12,5»
    // превращалось в не-число, и расчёт молча не запускался (находка М5).
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText("Найдите продукт"), "масло");
    await user.click(
      await screen.findByRole("button", { name: "Масло сливочное" }),
    );
    await user.type(
      await screen.findByLabelText(/Масло сливочное, граммы/),
      "12,5",
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/verify",
        expect.objectContaining({
          body: expect.objectContaining({
            items: [expect.objectContaining({ grams: 12.5 })],
          }),
        }),
      );
    });
    // Ввод остаётся на экране как набран: поле не «съедает» запятую.
    expect(screen.getByLabelText(/Масло сливочное, граммы/)).toHaveValue(
      "12,5",
    );
  });

  it("пустой состав не уходит в расчёт", async () => {
    // Считать нечего, а запрос на каждый чих нагружает решатель.
    renderScreen();

    await screen.findByText(/Добавьте продукты/);
    expect(api.POST).not.toHaveBeenCalled();
  });
});
