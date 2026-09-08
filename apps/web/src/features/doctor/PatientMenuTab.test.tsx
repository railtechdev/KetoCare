import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import menuRu from "../../locales/ru/menu.json";
import recipesRu from "../../locales/ru/recipes.json";
import { PatientRouter } from "../../test/PatientRouter";
import { PatientMenuTab } from "./PatientMenuTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
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
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("custom-dishes")) {
      return Promise.resolve({ data: { items: [DISH], total: 1 } });
    }
    if (path.includes("menus")) {
      return Promise.resolve({
        data: {
          date: "2026-09-08",
          items: [],
          totals: null,
          withdrawn_products: [],
        },
      });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
});

describe("питание пациента глазами специалиста", () => {
  it("показывает блюда ребёнка, а не только план дня", async () => {
    // Специалист передаёт раскладку из калькулятора «Передать пациенту», и до
    // этого списка увидеть переданное в карте было негде: блюдо сохранялось,
    // семья находила его при сборке меню, а тот, кто передал, — нет.
    renderFood();

    expect(await screen.findByText("Завтрак 4:1")).toBeInTheDocument();
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
