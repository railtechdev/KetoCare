import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { SectionRouter } from "../../test/SectionRouter";
import { weekStartOf } from "./dates";
import { WeekGrid } from "./WeekGrid";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

function week(start: string, extra: object[] = []) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${start}T12:00:00`);
    date.setDate(date.getDate() + index);
    return date.toLocaleDateString("sv-SE");
  });
  return {
    start,
    days: days.map((date, index) => ({
      date,
      menu:
        index === 0
          ? {
              id: "m1",
              totals: { kcal: 1180, ratio: 3.5 },
              items: [
                {
                  id: "i1",
                  meal_index: 2,
                  recipe_id: null,
                  custom_dish_id: "d0",
                  title: "Омлет",
                  portion_factor: 1,
                  ingredients: [
                    { product_id: "p1", name_ru: "Яйцо", grams: 40 },
                  ],
                },
                ...extra,
              ],
            }
          : null,
    })),
  };
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="menu">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<WeekGrid patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  (api.GET as Mock).mockImplementation(
    (path: string, options: { params: { query: { start: string } } }) =>
      Promise.resolve(
        path.endsWith("/week")
          ? { data: week(options.params.query.start) }
          : path.endsWith("/custom-dishes")
            ? { data: { items: [{ id: "d1", title: "Каша" }], total: 1 } }
            : { data: { prescription: { meals_per_day: 3 } } },
      ),
  );
  (api.POST as Mock).mockResolvedValue({
    data: { copied: ["2026-11-09"], skipped: [] },
  });
});

describe("неделя ребёнка", () => {
  it("ставит блюдо в строку его приёма и показывает итоги дня", async () => {
    renderGrid();

    const cell = await screen.findByText("Омлет");
    expect(cell.closest("tr")).toHaveTextContent("Приём 2");
    expect(screen.getByText("1 180 ккал")).toBeInTheDocument();
  });

  it("запрашивает неделю с понедельника", async () => {
    renderGrid();

    await screen.findByText("Омлет");
    const [, options] = (api.GET as Mock).mock.calls.find(([path]) =>
      (path as string).endsWith("/week"),
    )!;
    const start = options.params.query.start as string;
    expect(start).toBe(weekStartOf(start));
    expect(new Date(`${start}T12:00:00`).getDay()).toBe(1);
  });

  it("повторяет прошлую неделю только после подтверждения", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByText("Омлет");

    await user.click(
      screen.getByRole("button", { name: "Повторить прошлую неделю" }),
    );
    expect(api.POST).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus/week/copy",
        expect.anything(),
      ),
    );
  });

  it("печатает граммы блюд", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByText("Омлет");

    await user.click(screen.getByRole("button", { name: "Печать недели" }));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body).toHaveTextContent("Яйцо");
    expect(document.body).toHaveTextContent("40 г");
  });
});

describe("начало недели", () => {
  it("воскресенье относится к неделе, начатой в понедельник", () => {
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
  });
});

describe("ячейка недели", () => {
  const OMELETTE = {
    meal_index: 2,
    recipe_id: null,
    custom_dish_id: "d0",
    portion_factor: 1,
  };
  const SOUP = {
    id: "i2",
    meal_index: 3,
    recipe_id: null,
    custom_dish_id: "d2",
    title: "Суп",
    portion_factor: 1,
    eaten: false,
    ingredients: [],
  };

  /** Неделя, день недели с сервера и списки, из которых выбирают. */
  function mockApi({
    extra = [] as object[],
    dishes = [{ id: "d1", title: "Каша" }] as object[],
  } = {}) {
    (api.GET as Mock).mockImplementation(
      (path: string, options: { params: { query: { start: string } } }) => {
        if (path.endsWith("/week")) {
          return Promise.resolve({
            data: week(options.params.query.start, extra),
          });
        }
        if (path.endsWith("/custom-dishes")) {
          return Promise.resolve({ data: { items: dishes, total: 1 } });
        }
        if (path === "/api/v1/recipes") {
          return Promise.resolve({
            data: {
              items: [
                {
                  id: "r1",
                  title: "Кето-блинчики",
                  status: "published",
                  computed: { ratio: 3 },
                },
                { id: "r2", title: "Черновик", status: "draft" },
              ],
              total: 2,
            },
          });
        }
        if (path.endsWith("/menus")) {
          // День читается с сервера в момент записи: в нём уже стоит омлет.
          return Promise.resolve({
            data: {
              date: weekStartOf(new Date().toLocaleDateString("sv-SE")),
              items: [{ id: "i1", ...OMELETTE, eaten: false }, ...extra],
            },
          });
        }
        return Promise.resolve({
          data: { prescription: { meals_per_day: 3 } },
        });
      },
    );
    (api.PUT as Mock).mockResolvedValue({
      data: { date: "2026-11-09", items: [], totals: null },
    });
    (api.DELETE as Mock).mockResolvedValue({ data: undefined });
  }

  async function openFirstCell(user: ReturnType<typeof userEvent.setup>) {
    const addButtons = await screen.findAllByRole("button", {
      name: /Добавить блюдо: .*приём 1/,
    });
    await user.click(addButtons[0]!);
  }

  it("ставит блюдо ребёнка в приём, сохраняя прежние позиции дня", async () => {
    mockApi();
    const start = weekStartOf(new Date().toLocaleDateString("sv-SE"));
    renderGrid();
    const user = userEvent.setup();

    await openFirstCell(user);
    await user.click(await screen.findByRole("button", { name: "Каша" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    const body = (api.PUT as Mock).mock.calls[0]![1].body;
    expect(body.date).toBe(start);
    expect(body.items).toEqual([
      OMELETTE,
      {
        meal_index: 1,
        recipe_id: null,
        custom_dish_id: "d1",
        portion_factor: 1,
      },
    ]);
  });

  it("двойное нажатие не ставит блюдо дважды", async () => {
    mockApi();
    renderGrid();
    const user = userEvent.setup();

    await openFirstCell(user);
    const dish = await screen.findByRole("button", { name: "Каша" });
    fireEvent.click(dish);
    fireEvent.click(dish);

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.PUT).toHaveBeenCalledTimes(1);
  });

  it("предлагает опубликованные рецепты базы, черновики — нет", async () => {
    mockApi();
    renderGrid();
    const user = userEvent.setup();

    await openFirstCell(user);

    expect(
      await screen.findByRole("button", { name: /Кето-блинчики/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Черновик/ }),
    ).not.toBeInTheDocument();
  });

  it("рецепт с граммами базы ставится, только когда об этом сказано", async () => {
    // Через «Блюда» рецепт пересчитывается под ребёнка, здесь — нет: ячейка
    // говорит об этом и даёт выбрать, а не ставит молча исходные граммы.
    mockApi();
    renderGrid();
    const user = userEvent.setup();

    await openFirstCell(user);
    await user.click(
      await screen.findByRole("button", { name: /Кето-блинчики/ }),
    );

    expect(
      screen.getByText(/рассчитаны не под этого ребёнка/),
    ).toBeInTheDocument();
    expect(api.PUT).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Добавить с граммами рецепта" }),
    );

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect((api.PUT as Mock).mock.calls[0]![1].body.items[1]).toEqual({
      meal_index: 1,
      recipe_id: "r1",
      custom_dish_id: null,
      portion_factor: 1,
    });
  });

  it("пересчитанный под приём рецепт сохраняется ребёнку и встаёт в ячейку", async () => {
    mockApi();
    (api.POST as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/recipe-fits")
          ? {
              data: {
                target_ratio: 3,
                target_kcal: 400,
                engine_version: "1.0.0",
                items: [
                  {
                    recipe_id: "r1",
                    title: "Кето-блинчики",
                    status: "fitted",
                    ingredients: [
                      { product_id: "p1", name_ru: "Яйцо", grams: 55 },
                    ],
                    dish: {
                      kcal: 400,
                      fat_g: 30,
                      protein_g: 8,
                      carbs_g: 2,
                      fiber_g: 0,
                      ratio: 3,
                    },
                    ratio_within_tolerance: true,
                  },
                ],
              },
            }
          : { data: { id: "d9", title: "Кето-блинчики" } },
      ),
    );
    renderGrid();
    const user = userEvent.setup();

    await openFirstCell(user);
    await user.click(
      await screen.findByRole("button", { name: /Кето-блинчики/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Пересчитать под приём" }),
    );

    // Граммы видны до сохранения: их проверяет человек.
    expect(await screen.findByText("55 г")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Сохранить в блюда ребёнка и добавить",
      }),
    );

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/custom-dishes",
      expect.objectContaining({
        body: expect.objectContaining({
          ingredients: [{ product_id: "p1", grams: 55 }],
        }),
      }),
    );
    expect((api.PUT as Mock).mock.calls[0]![1].body.items[1]).toEqual({
      meal_index: 1,
      recipe_id: null,
      custom_dish_id: "d9",
      portion_factor: 1,
    });
  });

  it("без блюд ребёнка ведёт туда, где их собирают", async () => {
    mockApi({ dishes: [] });
    renderGrid();
    const user = userEvent.setup();

    await openFirstCell(user);

    expect(
      await screen.findByRole("link", { name: "Собрать блюдо" }),
    ).toHaveAttribute("href", expect.stringContaining("/dishes"));
  });

  it("убирает блюдо из ячейки, оставляя остальные", async () => {
    mockApi({ extra: [SOUP] });
    renderGrid();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /«Суп»/ }));
    await user.click(screen.getByRole("button", { name: "Убрать из меню" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect((api.PUT as Mock).mock.calls[0]![1].body.items).toEqual([OMELETTE]);
    expect(api.DELETE).not.toHaveBeenCalled();
  });

  it("последнее блюдо дня убирается вместе с меню на день — и говорит об этом", async () => {
    mockApi();
    renderGrid();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /«Омлет»/ }));

    expect(screen.getByText(/удалится меню на/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Убрать меню на день" }),
    );

    await waitFor(() => expect(api.DELETE).toHaveBeenCalled());
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("съеденное не убирается, и ячейка говорит почему", async () => {
    mockApi({ extra: [{ ...SOUP, eaten: true }] });
    renderGrid();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /«Суп»/ }));

    expect(
      screen.getByText(/Семья отметила блюдо съеденным/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Убрать из меню" }),
    ).not.toBeInTheDocument();
  });
});

describe("печать недели", () => {
  it("без блюд недоступна и называет причину", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/week")
          ? {
              data: {
                start: "2026-11-09",
                days: [{ date: "2026-11-09", menu: null }],
              },
            }
          : { data: { prescription: { meals_per_day: 3 } } },
      ),
    );
    renderGrid();

    const print = await screen.findByRole("button", { name: "Печать недели" });
    await waitFor(() => expect(print).toBeDisabled());
    expect(print).toHaveAccessibleDescription(
      "На этой неделе нет блюд — печатать нечего.",
    );
  });
});

describe("ячейка недели: состав дня берётся с сервера", () => {
  it("«последнее» по сетке блюдо не удаляет день, если семья уже добавила другое", async () => {
    // Сетка помнит один омлет, а на сервере за это время появился суп: удаление
    // дня унесло бы и его.
    (api.GET as Mock).mockImplementation(
      (path: string, options: { params: { query: { start: string } } }) =>
        Promise.resolve(
          path.endsWith("/week")
            ? { data: week(options.params.query.start) }
            : path.endsWith("/menus")
              ? {
                  data: {
                    date: "2026-11-09",
                    items: [
                      {
                        id: "i1",
                        meal_index: 2,
                        recipe_id: null,
                        custom_dish_id: "d0",
                        portion_factor: 1,
                        eaten: false,
                      },
                      {
                        id: "i9",
                        meal_index: 4,
                        recipe_id: null,
                        custom_dish_id: "d9",
                        portion_factor: 1,
                        eaten: false,
                      },
                    ],
                  },
                }
              : { data: { prescription: { meals_per_day: 3 } } },
        ),
    );
    (api.PUT as Mock).mockResolvedValue({
      data: { date: "2026-11-09", items: [], totals: null },
    });
    renderGrid();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /«Омлет»/ }));
    await user.click(
      screen.getByRole("button", { name: "Убрать меню на день" }),
    );

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect(api.DELETE).not.toHaveBeenCalled();
    expect((api.PUT as Mock).mock.calls[0]![1].body.items).toEqual([
      {
        meal_index: 4,
        recipe_id: null,
        custom_dish_id: "d9",
        portion_factor: 1,
      },
    ]);
  });

  it("рецепт с исключённым ребёнку продуктом «как в рецепте» не ставится", async () => {
    (api.GET as Mock).mockImplementation(
      (path: string, options: { params: { query: { start: string } } }) =>
        Promise.resolve(
          path.endsWith("/week")
            ? { data: week(options.params.query.start) }
            : path === "/api/v1/recipes"
              ? {
                  data: {
                    items: [
                      { id: "r1", title: "С арахисом", status: "published" },
                    ],
                    total: 1,
                  },
                }
              : path.endsWith("/custom-dishes")
                ? { data: { items: [], total: 0 } }
                : { data: { prescription: { meals_per_day: 3 } } },
        ),
    );
    (api.POST as Mock).mockResolvedValue({
      data: {
        target_ratio: 3,
        target_kcal: 400,
        engine_version: "1.0.0",
        items: [
          {
            recipe_id: "r1",
            title: "С арахисом",
            status: "excluded",
            reason: "Исключено этому ребёнку: Арахис.",
          },
        ],
      },
    });
    renderGrid();
    const user = userEvent.setup();

    const addButtons = await screen.findAllByRole("button", {
      name: /Добавить блюдо: .*приём 1/,
    });
    await user.click(addButtons[0]!);
    await user.click(await screen.findByRole("button", { name: /С арахисом/ }));
    await user.click(
      screen.getByRole("button", { name: "Пересчитать под приём" }),
    );

    expect(
      await screen.findByText("Исключено этому ребёнку: Арахис."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Добавить с граммами рецепта" }),
    ).not.toBeInTheDocument();
  });
});
