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

function renderScreens(props: Partial<Parameters<typeof Screens>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Screens session={SESSION} onSwitchChild={() => undefined} {...props} />
    </QueryClientProvider>,
  );
}

function tab(name: string) {
  return within(screen.getByRole("navigation")).getByRole("button", { name });
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("вкладки Mini App (ADR-0075)", () => {
  it("вкладок четыре: «Сегодня», «Дневник», «Блюда», «Помощник»", () => {
    renderScreens();

    const names = within(screen.getByRole("navigation"))
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["Сегодня", "Дневник", "Блюда", "Помощник"]);
    expect(tab("Сегодня")).toHaveAttribute("aria-current", "page");
  });

  it("состав расчёта переживает переход на другую вкладку и обратно", async () => {
    // Вкладки размонтировались при переключении: семья, собиравшая блюдо и
    // заглянувшая в меню, возвращалась к пустому расчёту.
    const user = userEvent.setup();
    renderScreens();

    await user.click(tab("Блюда"));
    await user.click(await screen.findByRole("radio", { name: "Расчёт" }));
    // Раздел грузится по требованию, а поиск ждёт паузы в наборе: на
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

    // Соседний раздел той же вкладки — и обратно.
    await user.click(screen.getByRole("radio", { name: "Рецепты" }));
    expect(screen.getByLabelText(/Масло сливочное, граммы/)).not.toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Расчёт" }));
    expect(screen.getByLabelText(/Масло сливочное, граммы/)).toBeVisible();

    // Другая вкладка — и обратно.
    await user.click(tab("Сегодня"));
    expect(screen.getByLabelText(/Масло сливочное, граммы/)).not.toBeVisible();
    await user.click(tab("Блюда"));
    const grams = screen.getByLabelText(/Масло сливочное, граммы/);
    expect(grams).toBeVisible();
    expect(grams).toHaveValue("30");
  });

  it("вкладка и заголовок экрана называют одно и то же", async () => {
    const user = userEvent.setup();
    renderScreens();

    await user.click(tab("Блюда"));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Блюда" }),
    ).toBeVisible();
  });

  it("не посещённая вкладка не монтируется вовсе", () => {
    // Чанки и запросы вкладок ждут первого перехода — приложение из чата
    // открывают ради меню на сегодня.
    renderScreens();

    expect(document.querySelector('[data-tab="dishes"]')).toBeNull();
    expect(document.querySelector('[data-tab="today"]')).not.toBeNull();
  });

  it("открывается вкладка, открытая в прошлый раз", async () => {
    const user = userEvent.setup();
    const first = renderScreens();
    await user.click(tab("Дневник"));
    first.unmount();

    renderScreens();

    expect(tab("Дневник")).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('[data-tab="today"]')).toBeNull();
  });

  it("имя ребёнка — в шапке над любой вкладкой", async () => {
    const user = userEvent.setup();
    renderScreens();

    expect(screen.getByText(SESSION.patientName)).toBeVisible();
    await user.click(tab("Помощник"));
    expect(screen.getByText(SESSION.patientName)).toBeVisible();
  });
});

describe("настройки — отдельным экраном (ADR-0075)", () => {
  it("шестерёнка открывает настройки, «Назад» возвращает на вкладку", async () => {
    const user = userEvent.setup();
    renderScreens();

    await user.click(screen.getByRole("button", { name: "Настройки" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Настройки" }),
    ).toBeVisible();
    expect(screen.getByText("Напоминания")).toBeVisible();
    expect(screen.getByText("Близкие")).toBeVisible();
    // Полоса вкладок под настройками не видна: это свой экран.
    expect(screen.queryByRole("navigation")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.queryByRole("heading", { name: "Настройки" })).toBeNull();
    expect(tab("Сегодня")).toHaveAttribute("aria-current", "page");
  });
});

describe("запуск с параметром (ADR-0075)", () => {
  it("«diary-ketones» открывает дневник сразу на форме кетонов", async () => {
    renderScreens({ launch: { tab: "diary", addKind: "ketones" } });

    expect(
      await screen.findByLabelText("Кетоны, ммоль/л", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    // Панель формы модальна и прячет остальное от программы чтения с экрана —
    // открытую вкладку проверяем по разметке.
    expect(
      document.querySelector('nav [aria-current="page"]')?.textContent,
    ).toBe("Дневник");
  });

  it("«reminders» открывает настройки", async () => {
    renderScreens({ launch: { settings: true, section: "reminders" } });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Настройки" }),
    ).toBeVisible();
  });

  it("параметр запуска важнее запомненной вкладки", () => {
    globalThis.localStorage.setItem("ketocare.miniapp.tab", "assistant");
    renderScreens({ launch: { tab: "today", view: "menu" } });

    expect(tab("Сегодня")).toHaveAttribute("aria-current", "page");
  });
});
