import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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

function solveResponse(overrides: Record<string, unknown> = {}) {
  return {
    dish: {
      items: [{ product_id: "p1", grams: 42.5 }],
      kcal: 300,
      fat_g: 31.2,
      protein_g: 4,
      carbs_g: 4,
      fiber_g: 0,
      ratio: 3.5,
      engine_version: "1.0.0",
    },
    ratio_within_tolerance: true,
    kcal_within_tolerance: true,
    excluded: [],
    ...overrides,
  };
}

function scaleResponse(overrides: Record<string, unknown> = {}) {
  return {
    dish: {
      items: [{ product_id: "p1", grams: 15 }],
      kcal: 112,
      fat_g: 12.4,
      protein_g: 0.1,
      carbs_g: 0.1,
      fiber_g: 0,
      ratio: 3.9,
      engine_version: "1.0.0",
    },
    ...overrides,
  };
}

/** Ответы по путям: экран ходит в три разные ручки, и общая заглушка их путает. */
function respond(byPath: Record<string, unknown>) {
  (api.POST as Mock).mockImplementation((path: string) => {
    const found = Object.entries(byPath).find(([key]) => path.endsWith(key));
    const body = found?.[1] ?? verifyResponse();
    return body instanceof Error
      ? Promise.resolve({ error: (body as ApiFailure).body })
      : Promise.resolve({ data: body });
  });
}

/** Отказ сервера в формате раздела 5.1 ТЗ. */
class ApiFailure extends Error {
  constructor(readonly body: unknown) {
    super("api error");
  }
}

async function switchTo(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("tab", { name }));
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

  it("подобранные массы попадают в состав, а не остаются в ответе", async () => {
    // Иначе цепочка «подобрал → округлил под кухонные весы → проверил»
    // рвётся на первом шаге: из подбора ведёт один выход — принять как есть.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");
    await user.type(screen.getByLabelText("Ккал на приём"), "300");
    await user.click(screen.getByRole("button", { name: "Подобрать массы" }));

    expect(await screen.findByLabelText(/Масло сливочное, граммы/)).toHaveValue(
      "42.5",
    );
  });

  it("подбор уходит с целями назначения и пределами", async () => {
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");
    await user.type(screen.getByLabelText("Ккал на приём"), "300");
    await user.type(screen.getByLabelText("Белок не меньше, г"), "6");
    await user.type(screen.getByLabelText("Углеводы не больше, г"), "4");
    await user.click(screen.getByRole("button", { name: "Подобрать массы" }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/solve",
        expect.objectContaining({
          body: expect.objectContaining({
            patient_id: SESSION.patientId,
            targets: expect.objectContaining({
              ratio: 3.5,
              kcal: 300,
              protein_min_g: 6,
              carbs_max_g: 4,
              net_carbs: false,
            }),
          }),
        }),
      );
    });
  });

  it("неразрешимая задача объясняется причиной, а не «ошибкой»", async () => {
    // Раздел 8.3 ТЗ: infeasible показывается человекочитаемой причиной.
    respond({
      "/calc/solve": new ApiFailure({
        error: {
          code: "infeasible_calculation",
          message: "Жиров набора не хватает на соотношение 3.5:1.",
        },
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");
    await user.type(screen.getByLabelText("Ккал на приём"), "300");
    await user.click(screen.getByRole("button", { name: "Подобрать массы" }));

    expect(
      await screen.findByText(/Жиров набора не хватает/),
    ).toBeInTheDocument();
  });

  it("снятые со входа продукты названы: решатель работал не со всем набором", async () => {
    respond({
      "/calc/solve": solveResponse({
        excluded: [{ product_id: "p1", name_ru: "Арахис" }],
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");
    await user.type(screen.getByLabelText("Ккал на приём"), "300");
    await user.click(screen.getByRole("button", { name: "Подобрать массы" }));

    expect(await screen.findByText(/сняты со входа/)).toBeInTheDocument();
    expect(screen.getByText("Арахис")).toBeInTheDocument();
  });

  it("без калорийности приёма подбор не запускается", async () => {
    // Подбирать не из чего: цель — это то, подо что решатель считает.
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");

    expect(
      screen.getByRole("button", { name: "Подобрать массы" }),
    ).toBeDisabled();
    expect(
      await screen.findByText(/без цели подбирать не из чего/),
    ).toBeInTheDocument();
  });

  it("в режиме подбора проверка сама не считает", async () => {
    // Иначе каждое нажатие в поле граммов уходило бы в ядро впустую.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");
    await user.type(screen.getByLabelText("Ккал на приём"), "300");

    // Ждать нужно ДОЛЬШЕ задержки автопересчёта (400 мс). Без этого проверка
    // проходит и со снятым ограничителем — просто потому, что таймер ещё не
    // сработал, и утверждение «не считает» ничего не проверяет. Ожидание
    // внутри `act`: за эти 900 мс срабатывают отложенные таймеры экрана, и их
    // обновления состояния обязаны попасть в тот же акт отрисовки.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/calc/verify",
      expect.anything(),
    );
  });

  it("пересчёт умножает раскладку на сервере, запятую понимает", async () => {
    respond({ "/calc/scale": scaleResponse() });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Пересчитать");
    const factor = screen.getByLabelText("Умножить на");
    await user.clear(factor);
    await user.type(factor, "0,5");
    await user.click(screen.getByRole("button", { name: "Пересчитать" }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/scale",
        expect.objectContaining({
          body: expect.objectContaining({
            factor: 0.5,
            items: [expect.objectContaining({ grams: 30 })],
          }),
        }),
      );
    });
    expect(await screen.findByText(/112.0 ккал/)).toBeInTheDocument();
  });

  it("пересчёт не выносит вердикта о допуске", async () => {
    // Множитель меняет и калорийность: сравнивать с целью приёма нечего.
    respond({ "/calc/scale": scaleResponse() });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Пересчитать");
    await user.click(screen.getByRole("button", { name: "Пересчитать" }));

    expect(
      await screen.findByText(/не сравнивает блюдо с целями приёма/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/в допуске назначения/)).not.toBeInTheDocument();
  });

  it("правка состава снимает прежний подбор", async () => {
    // Итог прежней раскладки рядом с новым составом — утверждение о блюде,
    // которого на экране уже нет.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);
    await switchTo(user, "Подобрать");
    await user.type(screen.getByLabelText("Ккал на приём"), "300");
    await user.click(screen.getByRole("button", { name: "Подобрать массы" }));
    expect(
      await screen.findByText(/Массы подставлены в состав/),
    ).toBeInTheDocument();

    await user.type(
      await screen.findByLabelText(/Масло сливочное, граммы/),
      "1",
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/Массы подставлены в состав/),
      ).not.toBeInTheDocument();
    });
  });

  it("пустой состав не уходит в расчёт", async () => {
    // Считать нечего, а запрос на каждый чих нагружает решатель.
    renderScreen();

    await screen.findByText(/Добавьте продукты/);
    expect(api.POST).not.toHaveBeenCalled();
  });
});
