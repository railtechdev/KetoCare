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
  medications = [],
  familyPhone = null,
}: {
  overview: unknown;
  menu?: unknown;
  medications?: unknown[];
  /** Телефон для семьи в бланке клиники; `null` — не задан. */
  familyPhone?: string | null;
}) {
  (api.GET as Mock).mockImplementation(async (path: string) => {
    if (path === "/api/v1/letterhead") {
      return {
        data: { text: { family_phone: familyPhone } },
        response: { status: 200 },
      };
    }
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
    // Схема препаратов и сегодняшние отметки — блок «Лекарства сегодня».
    if (path.endsWith("/medications")) {
      return {
        data: { items: medications, total: medications.length },
        response: { status: 200 },
      };
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
      .getByRole("heading", { name: "По меню на день" })
      .closest<HTMLElement>('[data-slot="card"]');
    expect(totals).not.toBeNull();
    // «600 из 1 200 ккал» и «добавьте ещё 600 ккал» — и всё.
    expect(
      within(totals as HTMLElement).getByText("600 из 1 200 ккал"),
    ).toBeVisible();
    expect(
      within(totals as HTMLElement).getAllByText(/не хватает 600 ккал/),
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
      await screen.findByRole("heading", { name: "Не отмечено: приём 2" }),
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

  it("граммы ближайшего приёма раскрыты сразу, приправа помечена (М1)", async () => {
    // Родитель у плиты видит, что взвесить, не открывая меню.
    serve({
      overview: { ...BASE, prescription: PRESCRIPTION },
      menu: menuOf([
        {
          ...item("b", 2, false, "Суп"),
          ingredients: [
            { product_id: "p1", name_ru: "Бульон куриный", grams: 150 },
            {
              product_id: "p2",
              name_ru: "Соль",
              grams: 0.5,
              counts_in_calculation: false,
            },
          ],
        } as ReturnType<typeof item>,
        {
          ...item("d", 3, false, "Котлета"),
          ingredients: [{ product_id: "p3", name_ru: "Фарш", grams: 60 }],
        } as ReturnType<typeof item>,
      ]),
    });
    renderScreen();

    const toggle = await screen.findByRole("button", { name: "Что взвесить" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Бульон куриный")).toBeInTheDocument();
    // Граммы — как прислал сервер, без своего пересчёта.
    const grams = screen.getByText("150 г");
    expect(grams).toBeInTheDocument();
    const salt = screen.getByText("Соль").closest("li") as HTMLElement;
    expect(salt).toHaveTextContent("приправа, не учитывается");
    // Строка не переносится целиком: граммы остаются в своём столбце справа,
    // основным цветом, а пометка стоит под именем, а не рядом с ним. На 360 px
    // длинное имя с пометкой выталкивало граммы к левому краю.
    const row = grams.closest("li") as HTMLElement;
    expect(row).not.toHaveClass("flex-wrap");
    expect(row.lastElementChild).toBe(grams);
    expect(grams).toHaveClass("shrink-0", "text-foreground");
    expect(grams).not.toHaveClass("text-muted-foreground");
    expect(screen.getByText("приправа, не учитывается").parentElement).not.toBe(
      screen.getByText("Соль"),
    );
    // Следующий приём сюда не попадает.
    expect(screen.queryByText("Фарш")).toBeNull();
  });

  it("«Как готовить» у рецепта ближайшего приёма открывает рецепт здесь же", async () => {
    serve({
      overview: { ...BASE, prescription: PRESCRIPTION },
      menu: menuOf([
        {
          ...item("b", 1, false, "Омлет"),
          recipe_id: "r1",
          custom_dish_id: null,
        } as unknown as ReturnType<typeof item>,
      ]),
    });
    const served = (api.GET as Mock).getMockImplementation();
    (api.GET as Mock).mockImplementation(
      async (path: string, options: unknown) =>
        path.endsWith("{recipe_id}")
          ? {
              data: {
                id: "r1",
                title: "Омлет",
                photo_path: null,
                servings: 1,
                yield_g: 100,
                instructions: "",
                ingredients: [],
                per_portion: null,
              },
              response: { status: 200 },
            }
          : served?.(path, options),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Как готовить" }),
    );
    // Списка рецептов здесь нет: «Назад» называет место, куда ведёт.
    expect(
      await screen.findByRole("button", { name: "К «Сегодня»" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "К списку" })).toBeNull();
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/recipes/{recipe_id}",
      expect.objectContaining({
        params: expect.objectContaining({ path: { recipe_id: "r1" } }),
      }),
    );
  });

  it("всё съедено — так и сказано", async () => {
    serve({
      overview: { ...BASE, prescription: PRESCRIPTION },
      menu: menuOf([item("a", 1, true, "Омлет")]),
    });
    renderScreen();

    // Блюдо стоит в одном приёме из четырёх: «всё съедено» было бы
    // неправдой о дне (аудит 26.11.2026, 2.2).
    expect(
      await screen.findByText(
        "Отмеченное съедено. В приёмах 2, 3, 4 блюд ещё нет.",
      ),
    ).toBeInTheDocument();
  });

  it("всё съедено во всех приёмах — так и сказано", async () => {
    serve({
      overview: { ...BASE, prescription: PRESCRIPTION },
      menu: menuOf([
        item("a", 1, true, "Омлет"),
        item("b", 2, true, "Суп"),
        item("c", 3, true, "Котлета"),
        item("d", 4, true, "Десерт"),
      ]),
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

  it("лекарства на сегодня — блоком после быстрых записей (Д4)", async () => {
    serve({
      overview: BASE,
      medications: [
        {
          id: "m1",
          drug_name: "Депакин",
          dose: "150 мг",
          frequency_code: "once_daily",
          frequency: null,
          started_at: "2020-01-01",
          stopped_at: null,
        },
      ],
    });
    renderScreen();

    const block = await screen.findByRole("heading", {
      name: "Лекарства сегодня",
    });
    const quick = screen.getByRole("heading", { name: "Записать" });
    expect(
      quick.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Дали: Депакин" }),
    ).toBeInTheDocument();
    // Быстрые записи остались прежними.
    expect(screen.getByRole("button", { name: /^Кетоны/ })).toBeInTheDocument();
  });

  it("без препаратов блока лекарств нет", async () => {
    renderScreen();

    await screen.findByRole("heading", { name: "Записать" });
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/medications",
        expect.anything(),
      ),
    );
    expect(screen.queryByText("Лекарства сегодня")).toBeNull();
    expect(screen.queryByText("Лекарства не загрузились")).toBeNull();
  });
});

/**
 * Р4 аудита Mini App: у семьи из Telegram кабинета нет — дату визита, телефон
 * клиники и схему препаратов ей больше негде взять.
 */
describe("семья без кабинета (Р4)", () => {
  const MEDICATION = {
    id: "m1",
    drug_name: "Вальпроат",
    dose: "250 мг",
    frequency_code: "twice_daily",
    frequency: "утром и на ночь",
    started_at: "2026-01-01",
    stopped_at: null,
  };

  it("ближайший визит к врачу — строкой, без назначения точки", async () => {
    const planned = new Date();
    planned.setDate(planned.getDate() + 10);
    const iso = `${planned.getFullYear()}-${String(planned.getMonth() + 1).padStart(2, "0")}-${String(planned.getDate()).padStart(2, "0")}`;
    serve({
      overview: {
        ...BASE,
        next_control: { planned_on: iso, overdue: false, purpose: null },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(/^Ближайший визит к врачу: \d{1,2} \S+/),
    ).toBeInTheDocument();
  });

  it("пропущенный визит говорится как есть и с тем, что делать", async () => {
    serve({
      overview: {
        ...BASE,
        next_control: {
          planned_on: "2026-01-05",
          overdue: true,
          purpose: null,
        },
      },
    });
    renderScreen();

    expect(
      await screen.findByText(/Визит к врачу был назначен на 5 января/),
    ).toBeInTheDocument();
  });

  it("после завершения терапии визит не показывается", async () => {
    serve({
      overview: {
        ...BASE,
        therapy_ended_on: "2026-01-01",
        next_control: {
          planned_on: "2027-01-05",
          overdue: false,
          purpose: null,
        },
      },
    });
    renderScreen();

    await screen.findByText("Терапия завершена");
    expect(screen.queryByText(/визит к врачу/i)).not.toBeInTheDocument();
  });

  it("телефон клиники — внизу, ссылкой для звонка", async () => {
    serve({ overview: BASE, familyPhone: "+998 (71) 123-45-67" });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Связь с клиникой" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "+998 (71) 123-45-67" }),
    ).toHaveAttribute("href", "tel:+998711234567");
  });

  it("телефон не задан — блока нет", async () => {
    serve({ overview: BASE });
    renderScreen();

    await screen.findByRole("heading", { name: "Сегодня", level: 1 });
    await waitFor(() =>
      expect(
        (api.GET as Mock).mock.calls.some(
          ([path]) => path === "/api/v1/letterhead",
        ),
      ).toBe(true),
    );
    expect(screen.queryByText("Связь с клиникой")).not.toBeInTheDocument();
  });

  it("«Вся схема» открывает схему препаратов на чтение", async () => {
    serve({ overview: BASE, medications: [MEDICATION] });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Все лекарства и дозы" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Лекарства и дозы" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Вальпроат")).toBeInTheDocument();
    expect(screen.getByText("принимается")).toBeInTheDocument();
    // Править нечего: ни «Дали», ни «Пропустили» на схеме нет.
    expect(screen.queryByRole("button", { name: /Дали/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "К «Сегодня»" }));
    expect(
      await screen.findByRole("heading", { name: "Сегодня", level: 1 }),
    ).toBeInTheDocument();
  });
});
