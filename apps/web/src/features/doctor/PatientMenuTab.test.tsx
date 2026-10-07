import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import menuRu from "../../locales/ru/menu.json";
import recipesRu from "../../locales/ru/recipes.json";
import { PatientRouter } from "../../test/PatientRouter";
import { todayIso } from "../menu/dates";
import { PatientMenuTab } from "./PatientMenuTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);
i18n.addResourceBundle("ru", "menu", menuRu, true, true);
i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DISH_ID = "33333333-3333-4333-8333-333333333333";

const DISH = {
  id: DISH_ID,
  title: "Завтрак 4:1",
  ingredients: [],
  computed: {
    kcal: 400,
    fat: 44,
    protein: 3,
    carbs: 2,
    fiber: 0,
    ratio: 4,
    engine_version: "1.0.0",
  },
};

/** День, который составила семья и в котором она уже отметила завтрак. */
const MENU = {
  id: "menu-1",
  patient_id: PATIENT_ID,
  date: todayIso(),
  totals: { kcal: 400, fat: 44, protein: 3, carbs: 2, fiber: 0, ratio: 4 },
  engine_version: "1.0.0",
  created_at: "2026-10-05T06:00:00Z",
  updated_at: "2026-10-05T06:00:00Z",
  updated_by_name: "Мария Иванова",
  updated_by_role: "parent",
  withdrawn_products: [],
  excluded_products: [],
  items: [
    {
      id: "item-1",
      menu_id: "menu-1",
      patient_id: PATIENT_ID,
      meal_index: 1,
      recipe_id: null,
      custom_dish_id: DISH_ID,
      portion_factor: 1,
      eaten: true,
      has_snapshot: true,
      ingredients: [],
      changed_since_saved: false,
    },
  ],
};

function respond(path: string) {
  if (path === "/api/v1/patients/{patient_id}/menus") return { data: MENU };
  if (path === "/api/v1/patients/{patient_id}/custom-dishes") {
    return { data: { items: [DISH], total: 1 } };
  }
  if (path === "/api/v1/patients/{patient_id}/overview") {
    return {
      data: {
        patient_id: PATIENT_ID,
        date: todayIso(),
        prescription: {
          kcal_per_day: 1600,
          carbs_limit_g: 15,
          meals_per_day: 4,
        },
        day: null,
        seizures_today: { entries: 0, count: 0 },
      },
    };
  }
  return { data: { items: [], total: 0 } };
}

function renderFood() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PatientRouter patientId={PATIENT_ID} view="menu">
          {children}
        </PatientRouter>
      </QueryClientProvider>
    );
  }

  return render(<PatientMenuTab patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) =>
    Promise.resolve(respond(path)),
  );
  (api.PUT as Mock).mockResolvedValue({ data: MENU });
});

describe("питание пациента глазами специалиста", () => {
  it("показывает блюда ребёнка, а не только план дня", async () => {
    // Специалист передаёт раскладку из калькулятора «Передать пациенту», и до
    // этого списка увидеть переданное в карте было негде: блюдо сохранялось,
    // семья находила его при сборке меню, а тот, кто передал, — нет.
    renderFood();

    expect(
      await screen.findByRole("heading", { name: "Блюда ребёнка" }),
    ).toBeInTheDocument();
  });

  it("называет блок по-чужому, а не «Мои блюда»", async () => {
    // Надпись от первого лица в чужой карте называет не того: блюда
    // принадлежат ребёнку, а читает их специалист.
    renderFood();

    expect(
      await screen.findByRole("heading", { name: "Блюда ребёнка" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Мои блюда" }),
    ).not.toBeInTheDocument();
  });

  it("ведёт блюдо в калькулятор ЭТОЙ карты, а не в общий", async () => {
    // В общем калькуляторе нет ни кетосоотношения ребёнка, ни его исключений,
    // и блюдо пациента он открыть не может — там нет пациента.
    renderFood();

    const link = await screen.findByRole("link", { name: /Завтрак 4:1/ });
    const href = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(href).toContain(`/app/patients/${PATIENT_ID}/calculator`);
    expect(href).toContain(`item=dish:${DISH_ID}`);
  });
});

describe("специалист составляет день (ADR-0047)", () => {
  it("добавляет блюдо в приём — тем же экраном, что и семья", async () => {
    const user = userEvent.setup();
    renderFood();

    await user.click(
      await screen.findByRole("button", {
        name: "Добавить блюдо в приём: Приём 2",
      }),
    );

    expect(
      await screen.findByRole("dialog", { name: /Приём 2/ }),
    ).toBeInTheDocument();
  });

  it("может убрать ошибочный день, а копировать — только в пустой", async () => {
    // Копирование поверх составленного дня заменило бы его состав вместе с
    // отметками «съедено» (ADR-0041): у составленного дня его нет.
    renderFood();

    expect(
      await screen.findByRole("button", { name: "Убрать план" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Скопировать день" }),
    ).toBeNull();
  });

  it("пустой день можно заполнить копией другого", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      path === "/api/v1/patients/{patient_id}/menus"
        ? Promise.resolve({ data: { ...MENU, items: [], totals: null } })
        : Promise.resolve(respond(path)),
    );
    renderFood();

    expect(
      await screen.findByRole("button", { name: "Скопировать день" }),
    ).toBeVisible();
  });

  it("видит отметку семьи, но не ставит её сам", async () => {
    // Отметка «съедено» — запись семьи о том, что ребёнок ел; специалист
    // составляет план, а не свидетельствует за семью.
    renderFood();

    expect(await screen.findByText("Съедено")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("убранная позиция уходит на сервер днём целиком", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockImplementation((path: string) =>
      path === "/api/v1/patients/{patient_id}/menus"
        ? Promise.resolve({
            data: {
              ...MENU,
              items: [
                { ...MENU.items[0], eaten: false },
                { ...MENU.items[0], id: "item-2", meal_index: 2, eaten: false },
              ],
            },
          })
        : Promise.resolve(respond(path)),
    );
    renderFood();

    const [first] = await screen.findAllByLabelText(
      "Убрать «Завтрак 4:1» из меню",
    );
    await user.click(first!);
    await user.click(await screen.findByRole("button", { name: "Убрать" }));

    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/menus",
      expect.objectContaining({
        body: expect.objectContaining({
          items: [expect.objectContaining({ meal_index: 2 })],
        }),
      }),
    );
  });

  it("видит, кто составил день", async () => {
    renderFood();

    expect(
      await screen.findByText(/^Составил\(а\): Мария Иванова, /),
    ).toBeVisible();
  });
});
