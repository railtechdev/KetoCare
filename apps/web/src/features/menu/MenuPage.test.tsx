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
});
