import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { NetworkError } from "@ketocare/api-client";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { MenuScreen } from "./MenuScreen";

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

function menu(overrides: Record<string, unknown> = {}) {
  return {
    id: "menu-1",
    patient_id: SESSION.patientId,
    date: "2026-08-31",
    totals: {
      kcal: 1200,
      fat: 100,
      protein: 24,
      carbs: 10,
      fiber: 3,
      ratio: 3.5,
    },
    engine_version: "1.0.0",
    items: [
      {
        id: "item-1",
        menu_id: "menu-1",
        patient_id: SESSION.patientId,
        meal_index: 1,
        recipe_id: null,
        custom_dish_id: null,
        portion_factor: 1,
        eaten: false,
        title: "Омлет на сливках",
        has_snapshot: true,
        changed_since_saved: false,
      },
    ],
    withdrawn_products: [],
    excluded_products: [],
    created_at: "2026-08-31T05:00:00Z",
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
  return render(<MenuScreen session={SESSION} />, { wrapper: Wrapper });
}

/** Сводка нужна экрану ради одного числа: сколько приёмов назначил врач. */
function overview(mealsPerDay: number | null = 4) {
  return {
    patient_id: SESSION.patientId,
    date: "2026-08-31",
    prescription:
      mealsPerDay === null
        ? null
        : {
            id: "p1",
            patient_id: SESSION.patientId,
            meals_per_day: mealsPerDay,
          },
    day: null,
    seizures_today: { count: 0 },
    seizure_trend: { direction: "flat" },
    last_reading_on: null,
  };
}

/** Ответы по адресу запроса: экран ходит уже в четыре разных места. */
function respond(
  options: {
    menu?: unknown;
    mealsPerDay?: number | null;
    recipes?: unknown[];
    dishes?: unknown[];
  } = {},
) {
  (api.GET as Mock).mockImplementation(async (path: string) => {
    if (path.includes("/overview")) {
      // `??` здесь был бы ошибкой: он считает null отсутствием значения, и
      // «нет назначения» превращалось бы в четыре приёма.
      const meals = "mealsPerDay" in options ? options.mealsPerDay : 4;
      return {
        data: overview(meals ?? null),
        response: { status: 200 },
      };
    }
    if (path.includes("/recipes")) {
      return {
        data: { items: options.recipes ?? [], total: 0 },
        response: { status: 200 },
      };
    }
    if (path.includes("/custom-dishes")) {
      return {
        data: { items: options.dishes ?? [], total: 0 },
        response: { status: 200 },
      };
    }
    return {
      data: options.menu === undefined ? menu() : options.menu,
      response: { status: options.menu === null ? 404 : 200 },
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  respond();
  (api.POST as Mock).mockResolvedValue({ data: {}, response: { status: 200 } });
  (api.PUT as Mock).mockResolvedValue({
    data: menu(),
    response: { status: 200 },
  });
  (api.DELETE as Mock).mockResolvedValue({ response: { status: 204 } });
});

describe("план дня в Mini App", () => {
  it("пауза без сети объясняется словами, а не пустотой", async () => {
    // Без сети запрос не уходит и не отказывает: он ждёт связи и продолжится
    // сам, когда она вернётся (ADR-0036). Экран при этом показывал пустоту —
    // ни объяснения, ни выхода, — и план дня выглядел несуществующим.
    (api.GET as Mock).mockImplementation(() => new Promise(() => undefined));
    onlineManager.setOnline(false);

    try {
      renderScreen();

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      expect(api.GET).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("отмечает съеденное", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("checkbox", { name: /Омлет/ }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
        expect.objectContaining({ body: { eaten: true } }),
      );
    });
  });

  it("отметка, не дошедшая до сервера, называет причину", async () => {
    // Без сети отметка отказывает сразу (ADR-0034); молча вернувшаяся галочка
    // читалась бы как «нажатие не сработало».
    const omelette = menu().items[0];
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        items: [
          omelette,
          { ...omelette, id: "item-2", meal_index: 2, title: "Суфле" },
        ],
      }),
      response: { status: 200 },
    });
    (api.POST as Mock).mockImplementation(() =>
      Promise.reject(new NetworkError()),
    );
    const user = userEvent.setup();
    renderScreen();

    const checkbox = await screen.findByRole("checkbox", { name: /Омлет/ });
    await user.click(checkbox);

    // Под той позицией, которую не приняли: внизу экрана при плане из
    // нескольких приёмов баннер оказывался ниже сгиба.
    const row = within(checkbox.closest("li")!);
    expect(await row.findByText("Отметка не сохранилась")).toBeInTheDocument();
    expect(
      row.getByText("Нет связи с сервером. Проверьте подключение."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Отметка не сохранилась")).toHaveLength(1);
    // Причина читается и при фокусе на самой позиции.
    expect(checkbox).toHaveAccessibleDescription(/Нет связи с сервером/);

    // Следующее нажатие уводит баннер: он о последней отметке, а не о первой.
    await user.click(screen.getByRole("checkbox", { name: /Суфле/ }));
    const next = within(
      screen.getByRole("checkbox", { name: /Суфле/ }).closest("li")!,
    );
    expect(await next.findByText("Отметка не сохранилась")).toBeInTheDocument();
    expect(row.queryByText("Отметка не сохранилась")).not.toBeInTheDocument();
  });

  it("снимает ошибочную отметку", async () => {
    // Без снятия ошибочное нажатие осталось бы в данных навсегда, а по этим
    // отметкам врач судит, выполнялся ли план.
    (api.GET as Mock).mockResolvedValue({
      data: menu({ items: [{ ...menu().items[0], eaten: true }] }),
      response: { status: 200 },
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("checkbox", { name: /Омлет/ }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: { eaten: false } }),
      );
    });
  });

  it("позиция раскрывается в «что взвесить» с граммовкой сервера", async () => {
    // Снимок отвечает, что и сколько взвесить, — прежде состав был недостижим
    // с экрана, который семья держит в руках на кухне (находка М3 аудита).
    // Граммы приходят уже на позицию (М1): клиент их не доумножает.
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        items: [
          {
            ...menu().items[0],
            ingredients: [
              { product_id: "prod-1", name_ru: "Яйцо куриное", grams: 50 },
            ],
          },
        ],
      }),
      response: { status: 200 },
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByText("Что взвесить"));

    expect(await screen.findByText("Яйцо куриное")).toBeInTheDocument();
    expect(screen.getByText("50 г")).toBeInTheDocument();
  });

  it("позиция без снимка не предлагает пустого раскрытия", async () => {
    renderScreen();

    await screen.findByText("Омлет на сливках");
    expect(screen.queryByText("Что взвесить")).not.toBeInTheDocument();
  });

  it("отсутствие плана — это состояние, а не ошибка", async () => {
    // Семья могла не планировать день; экран ошибки тут читался бы как поломка.
    (api.GET as Mock).mockResolvedValue({ response: { status: 404 } });
    renderScreen();

    expect(
      await screen.findByText(/Плана на этот день нет/),
    ).toBeInTheDocument();
    // И выход отсюда есть: до этого пустое состояние отправляло в кабинет,
    // не давая туда пути — адреса кабинета у Mini App не было вовсе.
    expect(
      screen.getByRole("link", { name: "Открыть кабинет" }),
    ).toHaveAttribute("href", SESSION.webUrl);
  });

  it("называет исключённые ребёнку продукты в плане", async () => {
    // По этому плану кормят сегодня — молчать нельзя.
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        excluded_products: [
          { product_id: "p1", name_ru: "Арахис", item_ids: ["item-1"] },
        ],
      }),
      response: { status: 200 },
    });
    renderScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent("Арахис");
  });

  it("предупреждает о правке рецепта после сохранения дня", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: menu({
        items: [{ ...menu().items[0], changed_since_saved: true }],
      }),
      response: { status: 200 },
    });
    renderScreen();

    expect(await screen.findByText(/Рецепт изменился/)).toBeInTheDocument();
  });
});

/**
 * Сборка дня с телефона (17.09.2026).
 *
 * До этапа Б экран был только на чтение: «меню составляют за столом». С этапа Б
 * довод перестал быть верным — у семьи из Telegram веб-кабинета нет вовсе, и
 * садиться ей было не за что.
 */
describe("сборка дня в Mini App", () => {
  const RECIPE = {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Запеканка со сливками",
    servings: 2,
    status: "published",
    computed: {
      kcal: 420,
      fat: 40,
      protein: 8,
      carbs: 3,
      fiber: 1,
      ratio: 3.6,
    },
  };

  it("находит блюдо, ставит в приём и сохраняет день", async () => {
    const user = userEvent.setup();
    respond({ recipes: [RECIPE] });
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Собрать день" }),
    );
    await user.click(await screen.findByRole("button", { name: /Запеканка/ }));

    // Приём выбирается из назначенных врачом, а не набирается числом.
    await user.selectOptions(
      screen.getByLabelText("Приём пищи"),
      screen.getByRole("option", { name: "Приём 2" }),
    );
    await user.clear(screen.getByLabelText("Порций"));
    await user.type(screen.getByLabelText("Порций"), "0,5");
    await user.click(screen.getByRole("button", { name: "Добавить в день" }));

    await waitFor(() => {
      expect(api.PUT).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus",
        expect.objectContaining({
          body: expect.objectContaining({
            items: [
              // Уже стоявшая позиция уезжает без искажений — иначе сервер
              // сочтёт её другой и сбросит отметку «съедено».
              expect.objectContaining({
                meal_index: 1,
                portion_factor: 1,
              }),
              {
                meal_index: 2,
                recipe_id: RECIPE.id,
                custom_dish_id: null,
                portion_factor: 0.5,
              },
            ],
          }),
        }),
      );
    });
  });

  it("итоги дня клиент не присылает — их считает ядро", async () => {
    const user = userEvent.setup();
    respond({ recipes: [RECIPE] });
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Собрать день" }),
    );
    await user.click(await screen.findByRole("button", { name: /Запеканка/ }));
    await user.click(screen.getByRole("button", { name: "Добавить в день" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    const call = (api.PUT as Mock).mock.calls[0] as [string, { body: unknown }];
    const body = call[1].body;
    // Второй источник клинических чисел в браузере запрещён правилом 2.
    expect(body).not.toHaveProperty("totals");
    expect(body).not.toHaveProperty("engine_version");
  });

  it("без назначения объясняет, почему собрать нельзя", async () => {
    const user = userEvent.setup();
    // Приёмы задаёт врач. Подставить один «чтобы работало» значило бы принять
    // медицинское решение за него.
    respond({ mealsPerDay: null });
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Собрать день" }),
    );

    expect(await screen.findByText(/Назначения пока нет/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Найти блюдо или рецепт"),
    ).not.toBeInTheDocument();
  });

  it("убирает позицию из дня", async () => {
    const user = userEvent.setup();
    respond({
      menu: menu({
        items: [
          {
            id: "item-1",
            menu_id: "menu-1",
            patient_id: SESSION.patientId,
            meal_index: 1,
            recipe_id: "r1",
            custom_dish_id: null,
            portion_factor: 1,
            eaten: false,
            title: "Омлет",
            changed_since_saved: false,
          },
          {
            id: "item-2",
            menu_id: "menu-1",
            patient_id: SESSION.patientId,
            meal_index: 2,
            recipe_id: "r2",
            custom_dish_id: null,
            portion_factor: 1,
            eaten: false,
            title: "Салат",
            changed_since_saved: false,
          },
        ],
      }),
    });
    renderScreen();

    const salad = (await screen.findByText("Салат")).closest("li");
    await user.click(
      within(salad as HTMLElement).getByRole("button", { name: "Убрать" }),
    );

    await waitFor(() => {
      expect(api.PUT).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus",
        expect.objectContaining({
          body: expect.objectContaining({
            items: [
              {
                meal_index: 1,
                recipe_id: "r1",
                custom_dish_id: null,
                portion_factor: 1,
              },
            ],
          }),
        }),
      );
    });
  });

  it("съеденное убрать нельзя — сначала снимается отметка", async () => {
    // Съеденное блюдо это уже не план, а запись о том, что ребёнок ел. Снять её
    // одним нажатием значило бы потерять клинические данные мимо решения.
    respond({
      menu: menu({
        items: [
          {
            id: "item-1",
            menu_id: "menu-1",
            patient_id: SESSION.patientId,
            meal_index: 1,
            recipe_id: "r1",
            custom_dish_id: null,
            portion_factor: 1,
            eaten: true,
            title: "Омлет",
            changed_since_saved: false,
          },
        ],
      }),
    });
    renderScreen();

    expect(await screen.findByText("Омлет")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Убрать" }),
    ).not.toBeInTheDocument();
  });

  it("последняя позиция убирается снятием плана, а не пустым днём", async () => {
    const user = userEvent.setup();
    renderScreen();

    const dish = (await screen.findByText("Омлет на сливках")).closest("li");
    await user.click(
      within(dish as HTMLElement).getByRole("button", { name: "Убрать" }),
    );

    // Схема требует хотя бы одну позицию: пустой `items` был бы отказом 422.
    await waitFor(() => expect(api.DELETE).toHaveBeenCalled());
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("завтрашний день запрашивается отдельно от сегодняшнего", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Омлет на сливках");

    await user.click(screen.getByRole("button", { name: "Завтра" }));

    await waitFor(() => {
      const dates = (api.GET as Mock).mock.calls
        .filter(([path]) => path.endsWith("/menus"))
        .map(([, options]) => options.params.query.date);
      expect(new Set(dates).size).toBe(2);
    });
  });
});

/**
 * Находки ревью 17.09.2026. Главная — F1: панель сборки отрисовывалась выше
 * запроса плана и не зависела от него, а состав считался из `menu.data`, равного
 * `undefined` при ожидании и при отказе. `PUT` уезжал с одной позицией, и сервер
 * трактовал это как «весь день теперь состоит из этого».
 */
describe("день не собирается вслепую", () => {
  it("пока план не загружен, собрать нечего — и кнопки нет", async () => {
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path.includes("/overview")) {
        return { data: overview(4), response: { status: 200 } };
      }
      // План висит: ответа нет ни успехом, ни отказом.
      if (path.endsWith("/menus")) return new Promise(() => undefined);
      return { data: { items: [], total: 0 }, response: { status: 200 } };
    });

    renderScreen();

    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Собрать день" }),
    ).not.toBeInTheDocument();
  });

  it("отказ загрузки плана не даёт его переписать", async () => {
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path.includes("/overview")) {
        return { data: overview(4), response: { status: 200 } };
      }
      if (path.endsWith("/menus")) {
        return { error: { detail: "упало" }, response: { status: 500 } };
      }
      return { data: { items: [], total: 0 }, response: { status: 200 } };
    });

    renderScreen();

    // Экран объясняет, что происходит, но собрать день не предлагает: иначе
    // добавление ужина стёрло бы завтрак и обед вместе с их отметками.
    expect(
      await screen.findByText(/Не удалось загрузить план дня/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Собрать день" }),
    ).not.toBeInTheDocument();
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("пока назначение не пришло, «назначения нет» не утверждается", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path.includes("/overview")) return new Promise(() => undefined);
      if (path.endsWith("/menus")) {
        return { data: menu(), response: { status: 200 } };
      }
      return { data: { items: [], total: 0 }, response: { status: 200 } };
    });

    renderScreen();
    await user.click(
      await screen.findByRole("button", { name: "Собрать день" }),
    );

    // «Назначения нет» — утверждение о клиническом факте; из незнания его
    // делать нельзя.
    expect(await screen.findByText(/Загружаем назначение/)).toBeInTheDocument();
    expect(screen.queryByText(/Назначения пока нет/)).not.toBeInTheDocument();
  });

  it("отказ при удалении позиции называется словами", async () => {
    const user = userEvent.setup();
    (api.PUT as Mock).mockResolvedValue({
      error: { error: { code: "conflict", message: "День занят" } },
      response: { status: 409 },
    });
    respond({
      menu: menu({
        items: [
          {
            id: "item-1",
            menu_id: "menu-1",
            patient_id: SESSION.patientId,
            meal_index: 1,
            recipe_id: "r1",
            custom_dish_id: null,
            portion_factor: 1,
            eaten: false,
            title: "Омлет",
            changed_since_saved: false,
          },
          {
            id: "item-2",
            menu_id: "menu-1",
            patient_id: SESSION.patientId,
            meal_index: 2,
            recipe_id: "r2",
            custom_dish_id: null,
            portion_factor: 1,
            eaten: false,
            title: "Салат",
            changed_since_saved: false,
          },
        ],
      }),
    });
    renderScreen();

    const salad = (await screen.findByText("Салат")).closest("li");
    await user.click(
      within(salad as HTMLElement).getByRole("button", { name: "Убрать" }),
    );

    // Панель сборки при удалении закрыта, и её сообщение сюда не доходило:
    // кнопка просто включалась обратно, а позиция оставалась на месте.
    expect(await screen.findByText("День занят")).toBeInTheDocument();
  });
});
