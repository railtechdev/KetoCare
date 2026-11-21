import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { MenuScreen } from "./MenuScreen";
import { dayAt } from "./useMenu";

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
  hasWebCredentials: false,
};

const PRESCRIPTION = {
  id: "p1",
  patient_id: SESSION.patientId,
  meals_per_day: 3,
  kcal_per_day: 1200,
  carbs_limit_g: 12,
  protein_g: 23,
  ratio: 3.5,
};

function ingredient(id: string, name: string, grams: number, counts = true) {
  return {
    product_id: id,
    name_ru: name,
    grams,
    counts_in_calculation: counts,
  };
}

function menuOn(
  date: string,
  ingredients: ReturnType<typeof ingredient>[],
  extra: Record<string, unknown> = {},
) {
  return {
    id: `menu-${date}`,
    patient_id: SESSION.patientId,
    date,
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
        id: `item-${date}`,
        menu_id: `menu-${date}`,
        patient_id: SESSION.patientId,
        meal_index: 1,
        recipe_id: null,
        custom_dish_id: "dish-1",
        portion_factor: 1,
        eaten: false,
        title: "Омлет на сливках",
        has_snapshot: true,
        changed_since_saved: false,
        ingredients,
      },
    ],
    withdrawn_products: [],
    excluded_products: [],
    updated_by_name: "Мама",
    updated_by_role: "parent",
    updated_at: "2026-08-31T05:00:00Z",
    created_at: "2026-08-31T05:00:00Z",
    ...extra,
  };
}

/** Меню по датам; неделя — из тех же меню, со вчерашнего дня, семь дней. */
function serve(menus: Record<string, unknown>) {
  (api.GET as Mock).mockImplementation(
    async (
      path: string,
      init?: { params?: { query?: { date?: string; start?: string } } },
    ) => {
      if (path.endsWith("/prescriptions/on")) {
        return {
          data: { date: dayAt(0), prescription: PRESCRIPTION },
          response: { status: 200 },
        };
      }
      if (path.endsWith("/menus/week")) {
        const start = init?.params?.query?.start ?? "";
        const days = [-1, 0, 1, 2, 3, 4, 5].map((offset) => {
          const date = dayAt(offset);
          return { date, menu: menus[date] ?? null };
        });
        return {
          data: { start, days },
          response: { status: 200 },
        };
      }
      if (path.endsWith("/menus")) {
        const planned = menus[init?.params?.query?.date ?? ""];
        return planned === undefined
          ? { data: undefined, response: { status: 404 } }
          : { data: planned, response: { status: 200 } };
      }
      return { data: { items: [], total: 0 }, response: { status: 200 } };
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
  return render(<MenuScreen session={SESSION} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.PUT as Mock).mockResolvedValue({ data: {}, response: { status: 200 } });
});

/**
 * Р3 аудита Mini App: диетолог составляет неделю, а семья видела три дня и не
 * могла посмотреть, что купить.
 */
describe("неделя в Mini App", () => {
  it("полоса из семи дней: вчера, сегодня, завтра и четыре дня с датой", async () => {
    serve({});
    renderScreen();

    const strip = await screen.findByRole("group", { name: "День" });
    const days = within(strip).getAllByRole("button");
    expect(days).toHaveLength(7);
    expect(days.slice(0, 3).map((day) => day.textContent)).toEqual([
      "Вчера",
      "Сегодня",
      "Завтра",
    ]);
    for (const day of days.slice(3)) {
      expect(day.textContent).toMatch(/^[а-я]{2} \d{1,2}$/);
    }
    expect(days[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("точка — у дней, где меню уже составлено", async () => {
    serve({ [dayAt(3)]: menuOn(dayAt(3), [ingredient("egg", "Яйцо", 40)]) });
    renderScreen();

    const strip = await screen.findByRole("group", { name: "День" });
    await waitFor(() =>
      expect(
        within(strip).getByRole("button", { name: /меню составлено/ }),
      ).toHaveAttribute("data-date", dayAt(3)),
    );
    expect(
      within(strip).getAllByRole("button", { name: /меню составлено/ }),
    ).toHaveLength(1);
  });

  it("дальний день открывается, собирается и копируется «Как в предыдущий день»", async () => {
    serve({ [dayAt(3)]: menuOn(dayAt(3), [ingredient("egg", "Яйцо", 40)]) });
    const user = userEvent.setup();
    renderScreen();

    const strip = await screen.findByRole("group", { name: "День" });
    const fourth = within(strip).getAllByRole("button")[5]!;
    await user.click(fourth);

    // Пустой день после дня с меню — перенос предлагается обобщённо.
    expect(
      await screen.findByRole("button", { name: "Как в предыдущий день" }),
    ).toBeInTheDocument();
    // Назначение — ЭТОГО дня (ADR-0078).
    await waitFor(() =>
      expect(
        (api.GET as Mock).mock.calls.some(
          ([path, init]) =>
            String(path).endsWith("/prescriptions/on") &&
            (init as { params: { query: { date: string } } }).params.query
              .date === dayAt(4),
        ),
      ).toBe(true),
    );
    // «Съедено» в будущий день не ставится.
    await user.click(within(strip).getAllByRole("button")[4]!);
    expect(
      await screen.findByText(
        "Отметить «съедено» можно в тот день, когда ребёнок ел.",
      ),
    ).toBeInTheDocument();
  });

  it("«Что купить» стоит у полосы дней, выше приёмов пищи", async () => {
    // В магазине открывают меню и ищут список вверху. Кнопка под всеми
    // приёмами и итогами дня была тремя экранами ниже полосы.
    serve({
      [dayAt(0)]: menuOn(dayAt(0), [ingredient("egg", "Яйцо", 40)]),
    });
    renderScreen();

    const shopping = await screen.findByRole("button", { name: "Что купить" });
    const firstMeal = await screen.findByRole("heading", { name: /Приём 1/ });
    expect(
      shopping.compareDocumentPosition(firstMeal) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("«Что купить» — продукты с сегодня по последний день полосы, тем же сложением, что в кабинете", async () => {
    serve({
      // Вчерашний день в список не входит: к нему не покупают.
      [dayAt(-1)]: menuOn(dayAt(-1), [ingredient("fish", "Треска", 500)]),
      [dayAt(0)]: menuOn(dayAt(0), [
        ingredient("egg", "Яйцо", 40),
        ingredient("salt", "Соль", 0.5, false),
      ]),
      [dayAt(2)]: menuOn(dayAt(2), [
        ingredient("egg", "Яйцо", 25),
        ingredient("cream", "Сливки 33%", 52.5),
      ]),
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Что купить" }));

    expect(
      await screen.findByRole("heading", { name: "Что купить", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Меню составлено на 2 дня из 6."),
    ).toBeInTheDocument();
    expect(screen.getByText(/^С .+ по .+\.$/)).toBeInTheDocument();

    const rows = screen.getAllByRole("checkbox");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("65 г")).toBeInTheDocument();
    expect(screen.getByText("52,5 г")).toBeInTheDocument();
    expect(screen.queryByText("Треска")).not.toBeInTheDocument();
    // Приправа — без граммов.
    expect(
      screen.getByText("Приправы по вкусу:").parentElement,
    ).toHaveTextContent("Соль");

    // Отметка «куплено» — на экране.
    await user.click(rows[0]!);
    expect(rows[0]).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Меню" }));
    expect(
      await screen.findByRole("group", { name: "День" }),
    ).toBeInTheDocument();
  });

  it("на эти дни меню нет — так и сказано", async () => {
    serve({});
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Что купить" }));

    expect(
      await screen.findByText(
        "На эти дни меню ещё не составлено — покупать по нему нечего.",
      ),
    ).toBeInTheDocument();
  });
});

/** Р2 аудита Mini App: несобранный день не тревожит семью. */
describe("день ещё собирается", () => {
  const off = {
    ratio_within_tolerance: false,
    kcal_within_tolerance: false,
    carbs_within_limit: true,
  };
  const small = {
    kcal: 290,
    fat: 25,
    protein: 6,
    carbs: 3,
    fiber: 1,
    ratio: 2.7,
  };

  it("сегодня, 290 из 1 200 ккал — спокойная строка, а не плашка", async () => {
    serve({
      [dayAt(0)]: menuOn(dayAt(0), [ingredient("egg", "Яйцо", 40)], {
        totals: small,
        tolerance: off,
      }),
    });
    renderScreen();

    expect(
      await screen.findByText(
        "День ещё собирается: кетосоотношение сверим, когда наберётся суточная норма калорий.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Итоги дня расходятся с назначением"),
    ).not.toBeInTheDocument();
  });

  it("вчерашний недобранный день — вердикт как есть", async () => {
    serve({
      [dayAt(-1)]: menuOn(dayAt(-1), [ingredient("egg", "Яйцо", 40)], {
        totals: small,
        tolerance: off,
      }),
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /^Вчера/ }));

    expect(
      await screen.findByText("Итоги дня расходятся с назначением"),
    ).toBeInTheDocument();
  });
});
