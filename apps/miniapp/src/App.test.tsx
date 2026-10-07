import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "./lib/i18n";
import { Screens } from "./App";
import { api } from "./lib/api";

vi.mock("./lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: true,
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

const OVERVIEW = {
  patient_id: SESSION.patientId,
  date: "2026-10-05",
  prescription: null,
  day: null,
  last_ketone: null,
  last_weight: null,
  seizures_today: { entries: 0, count: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.endsWith("/overview")) {
      return Promise.resolve({ data: OVERVIEW, response: { status: 200 } });
    }
    if (path.includes("/products")) {
      return Promise.resolve({
        data: { items: [PRODUCT], total: 1 },
        response: { status: 200 },
      });
    }
    // Прочие блоки главной (напоминания, близкие) — отказом: экран их
    // переживает, а тест не зависит от их формы.
    return Promise.resolve({
      error: { error: { code: "not_found", message: "нет" } },
      response: { status: 404 },
    });
  });
  (api.POST as Mock).mockResolvedValue({
    data: {
      dish: {
        items: [
          {
            product_id: "p1",
            grams: 30,
            kcal: 224,
            fat_g: 24.8,
            protein_g: 0.2,
            carbs_g: 0.2,
            fiber_g: 0,
          },
        ],
        kcal: 224,
        fat_g: 24.8,
        protein_g: 0.2,
        carbs_g: 0.2,
        fiber_g: 0,
        net_carbs_g: 0.2,
        ratio: 3.9,
        engine_version: "1.0.0",
      },
      ratio_within_tolerance: null,
      kcal_within_tolerance: null,
      excluded: [],
    },
  });
});

function renderScreens() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Screens session={SESSION} onSwitchChild={() => undefined} />
    </QueryClientProvider>,
  );
}

function tab(name: string) {
  return within(screen.getByRole("navigation")).getByRole("button", { name });
}

describe("вкладки Mini App", () => {
  it("состав калькулятора переживает переход на другую вкладку и обратно", async () => {
    // Вкладки размонтировались при переключении: семья, собиравшая блюдо и
    // заглянувшая в план дня, возвращалась к пустому калькулятору.
    const user = userEvent.setup();
    renderScreens();

    await user.click(tab("Расчёт"));
    // Вкладка грузится по требованию, а поиск ждёт паузы в наборе: на
    // загруженном раннере CI это дольше секунды по умолчанию у findBy*.
    await user.type(
      await screen.findByLabelText("Найдите продукт", {}, { timeout: 5000 }),
      "масло",
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Масло сливочное" },
        { timeout: 5000 },
      ),
    );
    await user.type(
      await screen.findByLabelText(/Масло сливочное, граммы/),
      "30",
    );

    await user.click(tab("Сводка"));
    // Вкладка скрыта, а не размонтирована.
    expect(screen.getByLabelText(/Масло сливочное, граммы/)).not.toBeVisible();

    await user.click(tab("Расчёт"));
    const grams = screen.getByLabelText(/Масло сливочное, граммы/);
    expect(grams).toBeVisible();
    expect(grams).toHaveValue("30");
  });

  it("вкладка и заголовок экрана называют одно и то же", async () => {
    // Вкладка «Расчёт» открывала экран «Калькулятор»: два имени одного места.
    const user = userEvent.setup();
    renderScreens();

    await user.click(tab("Расчёт"));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Расчёт" }),
    ).toBeVisible();
  });

  it("не посещённая вкладка не монтируется вовсе", () => {
    // Чанки и запросы вкладок ждут первого перехода — приложение из чата
    // открывают ради плана на сегодня.
    renderScreens();

    expect(document.querySelector('[data-tab="calculator"]')).toBeNull();
    expect(document.querySelector('[data-tab="home"]')).not.toBeNull();
  });
});
