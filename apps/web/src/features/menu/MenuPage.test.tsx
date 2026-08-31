import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { api } from "../../lib/api";
import { MenuPage } from "./MenuPage";
import { todayIso } from "./dates";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn(), POST: vi.fn() } };
});

// Пространство имён экрана подключает координатор (`lib/i18n.ts` — общий файл),
// поэтому тест регистрирует словарь сам: иначе проверялись бы ключи, а не текст.
i18n.addResourceBundle("ru", "menu", menuRu, true, true);

const TOTALS = {
  kcal: 1200,
  fat: 100,
  protein: 30,
  carbs: 12,
  fiber: 4,
  ratio: 2.4,
};

const MENU = {
  id: "menu-1",
  patient_id: "p1",
  date: todayIso(),
  totals: TOTALS,
  engine_version: "1.0.0",
  created_at: "2026-08-28T06:00:00Z",
  items: [
    {
      id: "item-1",
      menu_id: "menu-1",
      patient_id: "p1",
      meal_slot: "breakfast",
      recipe_id: "r1",
      custom_dish_id: null,
      portion_factor: 1,
      eaten: false,
      has_snapshot: true,
      changed_since_saved: false,
    },
    {
      id: "item-2",
      menu_id: "menu-1",
      patient_id: "p1",
      meal_slot: "dinner",
      recipe_id: null,
      custom_dish_id: "d1",
      portion_factor: 0.5,
      eaten: false,
      has_snapshot: true,
      changed_since_saved: false,
    },
  ],
};

function respond(path: string) {
  if (path === "/api/v1/patients") {
    return { data: { items: [{ id: "p1" }], total: 1 } };
  }
  if (path === "/api/v1/patients/{patient_id}/menus") {
    return { data: MENU };
  }
  if (path === "/api/v1/patients/{patient_id}/overview") {
    return {
      data: {
        patient_id: "p1",
        date: todayIso(),
        // Нормы назначения — источник строки «осталось до цели» (правило П18).
        prescription: {
          kcal_per_day: 1600,
          carbs_limit_g: 15,
          // Число приёмов врач задаёт с первого назначения; до сих пор оно не
          // доходило ни до одного экрана семьи.
          meals_per_day: 5,
        },
        day: {
          totals: TOTALS,
          // Вердикт приходит от сервера — экран его только показывает.
          tolerance: {
            ratio_within_tolerance: false,
            kcal_within_tolerance: true,
          },
          engine_version: "1.0.0",
        },
        seizures_today: { entries: 0, count: 0 },
      },
    };
  }
  if (path === "/api/v1/patients/{patient_id}/custom-dishes") {
    return {
      data: {
        items: [{ id: "d1", title: "Омлет на сливках", computed: null }],
        total: 1,
      },
    };
  }
  if (path === "/api/v1/recipes/{recipe_id}") {
    return {
      data: { id: "r1", title: "Каша на кокосовом масле", servings: 1 },
    };
  }
  throw new Error(`Unexpected GET ${path}`);
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MenuPage patientId="p1" />
    </QueryClientProvider>,
  );
}

describe("MenuPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(respond(path)),
    );
    (api.POST as unknown as Mock).mockResolvedValue({
      data: { ...MENU.items[0], eaten: true },
    });
    (api.PUT as unknown as Mock).mockResolvedValue({ data: MENU });
  });

  it("показывает позиции дня с названиями блюд", async () => {
    renderPage();

    expect(await screen.findByText("Каша на кокосовом масле")).toBeVisible();
    expect(screen.getByText("Омлет на сливках")).toBeVisible();
  });

  it("предупреждает о выходе за допуски по вердикту сервера", async () => {
    renderPage();

    expect(
      await screen.findByText(
        "Кетосоотношение дня выходит за допуски назначения",
      ),
    ).toBeVisible();
    // Соотношение помечено несоответствующим — вердикт пришёл с сервера.
    expect(screen.getByLabelText(/отклоняется от назначения/)).toBeVisible();
  });

  it("отметка «съедено» уходит на сервер", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByLabelText(
        "Отметить «Каша на кокосовом масле» съеденным",
      ),
    );

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
      expect.objectContaining({ body: { eaten: true } }),
    );
  });

  it("показывает, сколько осталось до норм назначения", async () => {
    renderPage();

    // 1600 − 1200 и 15 − 12: родитель не считает разницу в уме (правило П18).
    expect(await screen.findByText("осталось 400 ккал")).toBeVisible();
    expect(screen.getByText("осталось 3 г")).toBeVisible();
  });

  it("ошибка обновления не прячет уже показанный состав дня", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Каша на кокосовом масле");

    // Дальше день перечитать не удаётся. TanStack Query держит прежний ответ,
    // и состав дня должен остаться на экране: родитель, увидевший вместо своих
    // блюд красный блок, решит, что меню пропало, и составит день заново.
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      path === "/api/v1/patients/{patient_id}/menus"
        ? Promise.resolve({
            error: {
              error: { code: "internal", message: "Сервер недоступен" },
            },
          })
        : Promise.resolve(respond(path)),
    );

    // Отметка «съедено» перечитывает день (onSettled), и перечитывание падает.
    await user.click(
      screen.getByLabelText("Отметить «Каша на кокосовом масле» съеденным"),
    );

    expect(await screen.findByText("Не удалось загрузить меню.")).toBeVisible();
    expect(screen.getByText("Каша на кокосовом масле")).toBeVisible();
    expect(screen.getByText("Омлет на сливках")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  });

  it("приёмы пищи — один блок с заголовками третьего уровня", async () => {
    // Раньше каждый приём был отдельной карточкой на 190 px, и пустой день
    // занимал 1782 px до появления первого блюда (docs/AUDIT_UI_LAYOUT.md).
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Приёмы пищи" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Завтрак" }),
    ).toBeInTheDocument();
  });

  it("добавление блюда открывается панелью с названием приёма пищи", async () => {
    // Правило П32: форма не занимает высоту постоянно и открывается там, где
    // понятно, в какой приём пищи добавляют.
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: "Добавить блюдо в приём «Обед»",
      }),
    );

    expect(
      await screen.findByRole("dialog", { name: /Обед/ }),
    ).toBeInTheDocument();
  });

  it("у пустого дня одно пустое состояние, а не два", async () => {
    // Правило П27: раньше «Итоги появятся, когда будет хотя бы одно блюдо» и
    // «На этот день меню ещё не составлено» шли подряд — 332 px на одну мысль.
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/patients/{patient_id}/menus"
          ? { data: { ...MENU, items: [], totals: null } }
          : respond(path),
      ),
    );
    renderPage();

    expect(
      await screen.findByText(menuRu.day.empty as string),
    ).toBeInTheDocument();
    expect(screen.queryByText(menuRu.totals.none as string)).toBeNull();
  });

  it("называет назначенное число приёмов и сколько их в плане", async () => {
    // Семья планировала день по четырём слотам, не зная, что назначено пять
    // приёмов: `meals_per_day` не доходил ни до одного её экрана.
    //
    // В дне три блюда, но приёма два: второе блюдо стоит в том же завтраке.
    // Врач назначает именно приёмы, поэтому считаются они, а не позиции.
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/patients/{patient_id}/menus"
          ? {
              data: {
                ...MENU,
                items: [
                  ...MENU.items,
                  {
                    ...MENU.items[1],
                    id: "item-3",
                    meal_slot: "breakfast",
                  },
                ],
              },
            }
          : respond(path),
      ),
    );
    renderPage();

    expect(
      await screen.findByText(/Назначено приёмов в день: 5/),
    ).toBeInTheDocument();
    // Приёмы, а не блюда: в завтраке две позиции, и это один приём.
    expect(screen.getByText(/В плане на этот день: 2/)).toBeInTheDocument();
  });

  it("говорит, что блюдо изменили после составления дня", async () => {
    // День от правки рецепта не меняется — состав заморожен снимком. Но
    // рецепт правят, когда в нём нашли ошибку, и решать семье: пересобрать
    // день или оставить как есть.
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/patients/{patient_id}/menus"
          ? {
              data: {
                ...MENU,
                items: [
                  { ...MENU.items[0], changed_since_saved: true },
                  MENU.items[1],
                ],
              },
            }
          : respond(path),
      ),
    );
    renderPage();

    const marks = await screen.findAllByText(/Блюдо изменили после того/);
    expect(marks).toHaveLength(1);
  });

  it("называет выведенный продукт и блюдо, в котором он остался", async () => {
    // Вывод продукта из оборота убирает его из поиска, но не из уже
    // сохранённого дня — и правильно: подменять то, чем ребёнка кормили,
    // нельзя. Плохо было другое: день считался по нему без единой пометки, а
    // выводят продукт обычно потому, что его числа оказались неверными.
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/patients/{patient_id}/menus"
          ? {
              data: {
                ...MENU,
                withdrawn_products: [
                  {
                    product_id: "prod-1",
                    name_ru: "Масло льняное",
                    item_ids: ["item-1"],
                  },
                ],
              },
            }
          : respond(path),
      ),
    );
    renderPage();

    // Баннер над днём: числа посчитаны в том числе по этому продукту.
    // Баннер над днём: числа посчитаны в том числе по этому продукту.
    const banner = await screen.findByText(menuRu.withdrawn.title as string);
    expect(banner.parentElement).toHaveTextContent(/Масло льняное/);

    // День при этом читается и считается как прежде — запрета нет.
    expect(screen.getByText("Каша на кокосовом масле")).toBeInTheDocument();

    // Пометка стоит у той позиции, где продукт действительно есть.
    const marks = screen.getAllByText(/Выведен из оборота: Масло льняное/);
    expect(marks).toHaveLength(1);
  });

  it("удаление позиции подтверждается диалогом с названием блюда", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByLabelText("Убрать «Каша на кокосовом масле» из меню"),
    );

    // Заголовок называет объект, а не спрашивает «вы уверены?» (правило П14).
    expect(
      await screen.findByRole("alertdialog", {
        name: "Убрать «Каша на кокосовом масле» из меню?",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Убрать" }));

    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/menus",
      expect.objectContaining({
        body: expect.objectContaining({
          // Ушёл весь день без удалённой позиции: PUT задаёт состав целиком.
          items: [expect.objectContaining({ custom_dish_id: "d1" })],
        }),
      }),
    );
  });
});
