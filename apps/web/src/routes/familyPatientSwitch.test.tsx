import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PatientSwitcher } from "../features/patients/PatientSwitcher";
import i18n from "../lib/i18n";
import { api } from "../lib/api";
import calculatorRu from "../locales/ru/calculator.json";
import { SectionRouter } from "../test/SectionRouter";
import { SectionRoute } from "./SectionRoute";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("../features/auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u1", role: "parent" } }),
}));

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

function overview(patientId: string, ratio: number) {
  return {
    patient_id: patientId,
    date: "2026-09-11",
    prescription: {
      id: `p-${patientId}`,
      patient_id: patientId,
      ratio,
      kcal_per_day: 1200,
      protein_min_g: 12,
      carbs_max_g: 35,
      meals_per_day: 3,
      starts_on: "2026-08-01",
      created_at: "2026-08-01T10:00:00Z",
    },
    day: null,
    last_ketone: null,
    last_weight: null,
    seizures_today: { entries: 0, count: 0 },
    seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(
    async (
      path: string,
      options?: { params?: { path?: { patient_id?: string } } },
    ) => {
      if (path === "/api/v1/patients") {
        return {
          data: {
            items: [
              { id: FIRST, full_name: "Ребёнок 1" },
              { id: SECOND, full_name: "Ребёнок 2" },
            ],
            total: 2,
          },
          error: undefined,
        };
      }
      if (path.endsWith("/overview")) {
        const id = options?.params?.path?.patient_id ?? FIRST;
        return {
          data: overview(id, id === SECOND ? 4 : 3.5),
          error: undefined,
        };
      }
      return { data: { items: [], total: 0 }, error: undefined };
    },
  );
  (api.POST as Mock).mockResolvedValue({ data: undefined, error: undefined });
});

describe("кабинет семьи: смена ребёнка в шапке", () => {
  it("калькулятор берёт цель нового ребёнка, а не держит прежнюю", async () => {
    // У родителя двое детей. Выбор в шапке меняет `?patient=`, маршрут раздела
    // тот же. Без ключа по ребёнку экран сохранялся, и кетосоотношение первого
    // ребёнка оставалось в цели второго: проверка уходила с его назначением
    // чужим.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator" search={{ patient: FIRST }}>
          <PatientSwitcher />
          <SectionRoute />
        </SectionRouter>
      </QueryClientProvider>,
    );

    await waitFor(
      () => expect(screen.getByLabelText(/^Кетосоотношение/)).toHaveValue(3.5),
      { timeout: 5000 },
    );

    await user.selectOptions(
      document.querySelector("select") as HTMLSelectElement,
      SECOND,
    );

    await waitFor(
      () => expect(screen.getByLabelText(/^Кетосоотношение/)).toHaveValue(4),
      { timeout: 5000 },
    );
  }, 15000);

  it("задача отчёта и открытый объект прежнего ребёнка к новому не переходят", async () => {
    // Иначе экран отчёта второго ребёнка показывал готовность и ссылку на PDF
    // первого, а калькулятор — блюдо из его списка.
    function SearchProbe() {
      const search = useSearch({ from: "/app/$section" });
      return (
        <output data-testid="search">
          {`${search.patient ?? ""}|${search.job ?? ""}|${search.item ?? ""}|${search.tab ?? ""}`}
        </output>
      );
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <SectionRouter
          section="reports"
          search={{ patient: FIRST, job: "job-1", item: "dish:1", tab: "pdf" }}
        >
          <PatientSwitcher />
          <SearchProbe />
        </SectionRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("search")).toHaveTextContent(
      `${FIRST}|job-1|dish:1|pdf`,
    );
    await waitFor(() =>
      expect(document.querySelector("select")).not.toBeNull(),
    );

    await user.selectOptions(
      document.querySelector("select") as HTMLSelectElement,
      SECOND,
    );

    // Вкладка — не о ребёнке и остаётся.
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(`${SECOND}|||pdf`),
    );
  });
});
