import { NetworkError } from "@ketocare/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { dayAt } from "../menu/useMenu";
import { CalculatorScreen } from "./CalculatorScreen";
import { suggestedTitle } from "./SaveDish";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
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

const SAVED = {
  id: "dish-new",
  patient_id: SESSION.patientId,
  title: "Масло сливочное",
  ingredients: [{ product_id: "p1", grams: 30 }],
  computed: null,
  engine_version: "1.0.0",
  created_at: "2026-10-05T08:00:00Z",
};

/** День с уже съеденным завтраком: его отметка обязана пережить добавление. */
const TODAY_PLAN = {
  id: "menu-1",
  patient_id: SESSION.patientId,
  date: dayAt(0),
  totals: null,
  engine_version: "1.0.0",
  items: [
    {
      id: "item-1",
      menu_id: "menu-1",
      patient_id: SESSION.patientId,
      meal_index: 1,
      recipe_id: "r-1",
      custom_dish_id: null,
      portion_factor: 1.5,
      eaten: true,
      title: "Омлет",
      has_snapshot: true,
      changed_since_saved: false,
    },
  ],
  withdrawn_products: [],
  excluded_products: [],
  created_at: "2026-10-05T05:00:00Z",
};

function verifyResponse() {
  return {
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
    ratio_within_tolerance: true,
    kcal_within_tolerance: true,
    excluded: [],
  };
}

/** Ответы GET по адресу; план дня — по дате, `menus` решает, что с ним. */
function serve(
  menus: (date: string) => Promise<unknown> = (date) =>
    Promise.resolve(
      date === dayAt(0)
        ? { data: TODAY_PLAN, response: { status: 200 } }
        : { data: undefined, response: { status: 404 } },
    ),
) {
  (api.GET as Mock).mockImplementation(
    (path: string, init?: { params?: { query?: { date?: string } } }) => {
      if (path.includes("overview")) {
        return Promise.resolve({
          data: {
            patient_id: SESSION.patientId,
            date: dayAt(0),
            prescription: {
              ratio: 3.5,
              kcal_per_day: 1200,
              protein_g: 24,
              carbs_limit_g: 10,
              meals_per_day: 4,
            },
            day: null,
            seizures_today: { count: 0 },
          },
          response: { status: 200 },
        });
      }
      if (path.endsWith("/menus")) {
        return menus(init?.params?.query?.date ?? "");
      }
      return Promise.resolve({
        data: { items: [PRODUCT], total: 1 },
        response: { status: 200 },
      });
    },
  );
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

function saveCalls() {
  return (api.POST as Mock).mock.calls.filter(([path]) =>
    String(path).endsWith("/custom-dishes"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serve();
  (api.POST as Mock).mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith("/custom-dishes")
        ? { data: SAVED, response: { status: 201 } }
        : { data: verifyResponse(), response: { status: 200 } },
    ),
  );
  (api.PUT as Mock).mockResolvedValue({
    data: TODAY_PLAN,
    response: { status: 200 },
  });
});

async function saveDish(user: ReturnType<typeof userEvent.setup>) {
  await addProduct(user);
  const submit = await screen.findByRole("button", { name: "Сохранить блюдо" });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  expect(
    await screen.findByText("Блюдо «Масло сливочное» сохранено."),
  ).toBeInTheDocument();
}

describe("сохранить посчитанное как блюдо", () => {
  it("уходит с названием из продуктов и ключом попытки", async () => {
    const user = userEvent.setup();
    renderScreen();

    await saveDish(user);

    expect(saveCalls()).toHaveLength(1);
    const [, init] = saveCalls()[0] ?? [];
    expect(init.params.path).toEqual({ patient_id: SESSION.patientId });
    expect(typeof init.params.header["Idempotency-Key"]).toBe("string");
    // Граммы — числом, макронутриентов клиента нет: состав пересчитывает
    // сервер по product_id.
    expect(init.body).toEqual({
      title: "Масло сливочное",
      ingredients: [{ product_id: "p1", grams: 30 }],
    });
  });

  it("до расчёта формы нет, а пока правка не досчитана — кнопка молчит с причиной", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(
      screen.queryByRole("button", { name: "Сохранить блюдо" }),
    ).not.toBeInTheDocument();
    await addProduct(user);
    const submit = await screen.findByRole("button", {
      name: "Сохранить блюдо",
    });
    await waitFor(() => expect(submit).toBeEnabled());

    // Сразу после правки расчёт ещё по прежней граммовке: сохранить её значило
    // бы унести в блюда ребёнка непроверенные граммы.
    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "5");

    expect(
      screen.getByRole("button", { name: "Сохранить блюдо" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Сохранить можно после расчёта."),
    ).toBeInTheDocument();
  });

  it("повтор после потерянного ответа уходит с тем же ключом", async () => {
    // Ответ потерялся — блюдо на сервере могло уже появиться. Тот же ключ
    // (ADR-0035) вернёт его, а не заведёт второе такое же.
    let attempt = 0;
    (api.POST as Mock).mockImplementation((path: string) => {
      if (!path.endsWith("/custom-dishes")) {
        return Promise.resolve({ data: verifyResponse() });
      }
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new NetworkError())
        : Promise.resolve({ data: SAVED, response: { status: 201 } });
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    const submit = await screen.findByRole("button", {
      name: "Сохранить блюдо",
    });
    await waitFor(() => expect(submit).toBeEnabled());

    await user.click(submit);
    expect(
      await screen.findByText("Не удалось сохранить блюдо"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить блюдо" }));
    await screen.findByText("Блюдо «Масло сливочное» сохранено.");

    const keys = saveCalls().map(
      ([, init]) => init.params.header["Idempotency-Key"],
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("название по умолчанию — из первых продуктов состава", () => {
    const row = (name: string) => ({
      product: {
        id: name,
        name,
        kcal: 0,
        fat: 0,
        protein: 0,
        carbs: 0,
        fiber: 0,
      },
      grams: "1",
    });
    expect(suggestedTitle([row("Масло"), row("Яйцо")])).toBe("Масло, Яйцо");
    expect(suggestedTitle([row("А"), row("Б"), row("В"), row("Г")])).toBe(
      "А, Б, В…",
    );
  });
});

/**
 * «Добавить в план» — тем же путём записи, что сборка дня на вкладке «Меню»:
 * день сохраняется целиком, и уже стоящие позиции обязаны уехать без
 * искажений, иначе сервер снимет их отметки «съедено».
 */
describe("сохранённое блюдо — в план дня", () => {
  it("дописывается к дню, не трогая съеденного", async () => {
    const user = userEvent.setup();
    renderScreen();
    await saveDish(user);

    await user.selectOptions(
      await screen.findByLabelText("Приём пищи"),
      "Приём 2",
    );
    await user.click(
      await screen.findByRole("button", { name: "Добавить в план" }),
    );

    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/menus",
      {
        params: { path: { patient_id: SESSION.patientId } },
        body: {
          date: dayAt(0),
          items: [
            // Съеденный завтрак — байт в байт: ключ и порция те же.
            {
              meal_index: 1,
              recipe_id: "r-1",
              custom_dish_id: null,
              portion_factor: 1.5,
            },
            {
              meal_index: 2,
              recipe_id: null,
              custom_dish_id: "dish-new",
              portion_factor: 1,
            },
          ],
        },
      },
    );
    expect(
      await screen.findByText("Добавлено в план: Сегодня, приём 2."),
    ).toBeInTheDocument();
    // Повторное нажатие поставило бы блюдо в тот же приём второй раз.
    expect(
      screen.queryByRole("button", { name: "Добавить в план" }),
    ).not.toBeInTheDocument();
  });

  it("на завтра — в завтрашний день", async () => {
    const user = userEvent.setup();
    renderScreen();
    await saveDish(user);

    const days = await screen.findByRole("group", { name: "День" });
    await user.click(within(days).getByRole("button", { name: "Завтра" }));
    await user.click(
      await screen.findByRole("button", { name: "Добавить в план" }),
    );

    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    const [, init] = (api.PUT as Mock).mock.calls[0] ?? [];
    expect(init.body).toEqual({
      date: dayAt(1),
      items: [
        {
          meal_index: 1,
          recipe_id: null,
          custom_dish_id: "dish-new",
          portion_factor: 1,
        },
      ],
    });
  });

  it("пока план дня не загружен, добавить нельзя", async () => {
    serve(() => new Promise(() => undefined));
    const user = userEvent.setup();
    renderScreen();
    await saveDish(user);

    expect(
      await screen.findByText(/Загружаем план этого дня/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Добавить в план" }),
    ).not.toBeInTheDocument();
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("отказ загрузки плана не даёт его переписать", async () => {
    serve(() =>
      Promise.resolve({
        error: { error: { code: "internal", message: "Сервер недоступен." } },
        response: { status: 500 },
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    await saveDish(user);

    expect(
      await screen.findByText(/Не удалось загрузить план этого дня/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Добавить в план" }),
    ).not.toBeInTheDocument();
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("правка состава после сохранения возвращает форму: это уже другое блюдо", async () => {
    const user = userEvent.setup();
    renderScreen();
    await saveDish(user);

    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "5");

    expect(
      screen.queryByText("Блюдо «Масло сливочное» сохранено."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Сохранить блюдо" }),
    ).toBeInTheDocument();
  });
});
