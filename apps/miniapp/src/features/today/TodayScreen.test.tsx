import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { primaryActions } from "@ketocare/ui/testing";

import { TodayScreen } from "./TodayScreen";

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
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: true,
};

const PRESCRIPTION = {
  ratio: 4,
  kcal_per_day: 1200,
  protein_g: 20,
  carbs_limit_g: 10,
  meals_per_day: 4,
};

const BASE = {
  patient_id: SESSION.patientId,
  date: "2026-10-05",
  prescription: null,
  day: null,
  last_ketone: null,
  last_weight: null,
  seizures_today: { count: 0 },
};

function item(id: string, meal: number, eaten: boolean, title: string) {
  return {
    id,
    meal_index: meal,
    recipe_id: null,
    custom_dish_id: `dish-${id}`,
    portion_factor: 1,
    eaten,
    title,
    ingredients: [],
    changed_since_saved: false,
  };
}

function menuOf(items: ReturnType<typeof item>[]) {
  return {
    date: "2026-10-05",
    items,
    totals: null,
    excluded_products: [],
    withdrawn_products: [],
    updated_by_name: null,
    updated_by_role: "parent",
    updated_at: "2026-10-05T06:00:00Z",
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
  return render(<TodayScreen session={SESSION} />, { wrapper: Wrapper });
}

/** Сводка и меню дня — по своим адресам; меню нет — 404, как у сервера. */
function serve({
  overview,
  menu = null,
}: {
  overview: unknown;
  menu?: unknown;
}) {
  (api.GET as Mock).mockImplementation(async (path: string) => {
    if (path.endsWith("/overview")) {
      return { data: overview, response: { status: 200 } };
    }
    // Назначение дня — то же, что в сводке (меню берёт его отсюда, ADR-0078).
    if (path.endsWith("/prescriptions/on")) {
      return {
        data: {
          prescription:
            (overview as { prescription?: unknown } | null)?.prescription ??
            null,
        },
        response: { status: 200 },
      };
    }
    if (path.endsWith("/menus")) {
      return menu === null
        ? {
            error: { error: { code: "not_found", message: "нет" } },
            response: { status: 404 },
          }
        : { data: menu, response: { status: 200 } };
    }
    return { data: [], response: { status: 200 } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serve({ overview: BASE });
});

describe("«Сегодня» в Mini App", () => {
  it("пауза без сети объясняется словами, а не пустотой", async () => {
    // Без сети запрос не уходит и не отказывает: он ждёт связи и продолжится
    // сам (ADR-0036), а на экране не должно быть пустоты без объяснения.
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

  it("итоги дня — один блок, калорийность в нём названа один раз", async () => {
    // Аудит 12.11.2026: калорийность стояла в одной карточке трижды — полосой
    // макронутриентов, полосой цели и строкой вердикта.
    serve({
      overview: {
        ...BASE,
        prescription: PRESCRIPTION,
        day: {
          totals: {
            kcal: 600,
            fat: 60,
            protein: 10,
            carbs: 5,
            fiber: 0,
            ratio: 4,
          },
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: false,
          },
          tolerance_gap: null,
          engine_version: "1.0.0",
        },
      },
    });
    renderScreen();

    expect(
      await screen.findByText("Кетосоотношение дня соответствует назначению."),
    ).toBeInTheDocument();
    const totals = screen
      .getByRole("heading", { name: "Итоги дня" })
      .closest<HTMLElement>('[data-slot="card"]');
    expect(totals).not.toBeNull();
    // «600 из 1 200 ккал» и «добавьте ещё 600 ккал» — и всё.
    expect(
      within(totals as HTMLElement).getByText("600 из 1 200 ккал"),
    ).toBeVisible();
    expect(
      within(totals as HTMLElement).getAllByText(/добавьте ещё 600 ккал/),
    ).toHaveLength(1);
    expect(within(totals as HTMLElement).queryByText(/^Набрано/)).toBeNull();
  });

  it("назначение — одной строкой, с жидкостью, если врач её задал (ADR-0069)", async () => {
    serve({
      overview: {
        ...BASE,
        prescription: { ...PRESCRIPTION, fluid_ml_per_day: 1400 },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(
        /кетосоотношение 4\.0 : 1 · 1\s?200 ккал в сутки/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/жидкость 1\s?400 мл в сутки/)).toBeInTheDocument();
  });

  it("настроек на «Сегодня» нет, громкая кнопка — не больше одной (П31)", async () => {
    // Напоминания, близкие и вход в кабинет переехали на экран настроек
    // (ADR-0075): на главной они занимали два экрана под сводкой.
    serve({ overview: { ...BASE, prescription: PRESCRIPTION } });
    const { container } = renderScreen();

    await screen.findByRole("button", { name: "Составить меню" });
    expect(screen.queryByText("Напоминания")).toBeNull();
    expect(screen.queryByText("Близкие")).toBeNull();
    expect(screen.queryByText("Вход в кабинет")).toBeNull();
    expect(primaryActions(container).length).toBeLessThanOrEqual(1);
  });

  it("последние кетоны — с единицей и способом замера", async () => {
    // «1,8» без «ммоль/л» и «по моче» с порогом врача не сравнить.
    serve({
      overview: {
        ...BASE,
        last_ketone: {
          value: 1.8,
          method: "urine",
          occurred_at: "2026-10-05T07:30:00Z",
        },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(/Кетоны в последний раз: 1,8 ммоль\/л по моче/),
    ).toBeInTheDocument();
  });

  it("говорит о вчерашнем недоборе словами клиники, когда сервер его назвал", async () => {
    serve({
      overview: {
        ...BASE,
        yesterday_shortfall: {
          date: "2026-10-04",
          eaten_kcal: 600,
          target_kcal: 1200,
          shortfall_kcal: 600,
        },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(
        "Вчера ребёнок недобрал 600 ккал от суточной нормы — это может сказаться на его самочувствии. Если так бывает часто, обсудите с врачом.",
      ),
    ).toBeInTheDocument();
  });

  it("назначение с датой начала позже сегодня — строкой с датой", async () => {
    serve({
      overview: {
        ...BASE,
        upcoming_prescription: {
          id: "rx-next",
          patient_id: SESSION.patientId,
          ratio: 4,
          kcal_per_day: 1300,
          protein_g: 23,
          carbs_limit_g: 5,
          meals_per_day: 4,
          fluid_ml_per_day: null,
          restrictions: null,
          author_id: "u1",
          effective_from: "2026-10-08",
          created_at: "2026-10-05T10:00:00Z",
        },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(/С 08\.10 — новое назначение/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Назначения пока нет/)).not.toBeInTheDocument();
  });

  it("без вчерашнего недобора о вчера молчит", async () => {
    serve({ overview: { ...BASE, yesterday_shortfall: null } });
    renderScreen();

    expect(
      await screen.findByText(
        "Назначения пока нет — его задаёт врач. Дневник вести можно уже сейчас.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Вчера ребёнок недобрал/),
    ).not.toBeInTheDocument();
  });

  it("день, посчитанный прежним ядром, объясняется своей причиной", async () => {
    serve({
      overview: {
        ...BASE,
        day: {
          totals: {
            kcal: 600,
            fat: 60,
            protein: 10,
            carbs: 5,
            fiber: 0,
            ratio: 4,
          },
          tolerance: null,
          tolerance_gap: "engine_changed",
          engine_version: "0.4.0",
        },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(/Этот день составлен давно/),
    ).toBeInTheDocument();
  });

  it("ближайший приём — первый с несъеденным, отмечается прямо отсюда", async () => {
    serve({
      overview: { ...BASE, prescription: PRESCRIPTION },
      menu: menuOf([
        item("a", 1, true, "Омлет"),
        item("b", 2, false, "Суп"),
        item("c", 2, false, "Салат"),
        item("d", 3, false, "Котлета"),
      ]),
    });
    (api.POST as Mock).mockResolvedValue({ data: { eaten: true } });
    const user = userEvent.setup();
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Сейчас — приём 2" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Суп")).toBeInTheDocument();
    expect(screen.getByText("Салат")).toBeInTheDocument();
    // Уже съеденный завтрак и следующий приём — в меню, а не здесь.
    expect(screen.queryByText("Омлет")).toBeNull();
    expect(screen.queryByText("Котлета")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Суп" }));
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
        expect.objectContaining({ body: { eaten: true } }),
      );
    });
  });

  it("всё съедено — так и сказано", async () => {
    serve({
      overview: { ...BASE, prescription: PRESCRIPTION },
      menu: menuOf([item("a", 1, true, "Омлет")]),
    });
    renderScreen();

    expect(
      await screen.findByText("Всё из меню на сегодня отмечено съеденным."),
    ).toBeInTheDocument();
  });

  it("меню нет — «Составить меню» открывает меню со всеми приёмами", async () => {
    serve({ overview: { ...BASE, prescription: PRESCRIPTION } });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Составить меню" }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Меню" }),
    ).toBeInTheDocument();
    // Все четыре назначенных приёма, в том числе пустые, — каждый со своим
    // «Добавить блюдо».
    for (const index of [1, 2, 3, 4]) {
      expect(
        await screen.findByRole("button", {
          name: `Добавить блюдо в приём ${index}`,
        }),
      ).toBeInTheDocument();
    }
  });

  it("без назначения собрать меню не предлагается — одна строка", async () => {
    renderScreen();

    expect(
      await screen.findByText(
        "Назначения пока нет, и приёмов пищи тоже: их задаёт врач.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Составить меню" })).toBeNull();
  });

  it("«Кетоны» открывает форму кетонов сразу, курсор — в поле значения", async () => {
    // Прежде: вкладка, «Добавить запись», выбор вида — и курсор на дате.
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /^Кетоны/ }));

    const value = await screen.findByLabelText("Кетоны, ммоль/л");
    await waitFor(() => {
      expect(value).toHaveFocus();
    });
    expect(screen.queryByText("Что записать?")).toBeNull();
  });
});
