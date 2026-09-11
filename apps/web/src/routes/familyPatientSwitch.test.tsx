import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PatientGate } from "../features/patients/PatientGate";
import { PatientSwitcher } from "../features/patients/PatientSwitcher";
import i18n from "../lib/i18n";
import { api } from "../lib/api";
import calculatorRu from "../locales/ru/calculator.json";
import commonRu from "../locales/ru/common.json";
import type { SectionSearch } from "../router";
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

/** Что сейчас в адресе: ребёнок | задача | объект | вкладка. */
function SearchProbe() {
  const search = useSearch({ from: "/app/$section" });
  return (
    <output data-testid="search">
      {`${search.patient ?? ""}|${search.job ?? ""}|${search.item ?? ""}|${search.tab ?? ""}`}
    </output>
  );
}

function renderIn(section: string, search: SectionSearch, children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SectionRouter section={section} search={search}>
        {children}
      </SectionRouter>
    </QueryClientProvider>,
  );
}

async function switchTo(patientId: string) {
  const user = userEvent.setup();
  // По подписи, а не первым полем выбора: на экране калькулятора свои
  // списки, а связь подписи с полем переключателя проверяется заодно.
  await user.selectOptions(
    await screen.findByRole("combobox", { name: commonRu.nav.patient }),
    patientId,
  );
}

describe("кабинет семьи: смена ребёнка в шапке", () => {
  it("калькулятор берёт цель нового ребёнка, а не держит прежнюю", async () => {
    // У родителя двое детей. Выбор в шапке меняет `?patient=`, маршрут раздела
    // тот же. Без ключа по ребёнку экран сохранялся, и кетосоотношение первого
    // ребёнка оставалось в цели второго.
    renderIn(
      "calculator",
      { patient: FIRST },
      <>
        <PatientSwitcher />
        <SectionRoute />
      </>,
    );

    await waitFor(
      () => expect(screen.getByLabelText(/^Кетосоотношение/)).toHaveValue(3.5),
      { timeout: 5000 },
    );

    await switchTo(SECOND);

    await waitFor(
      () => expect(screen.getByLabelText(/^Кетосоотношение/)).toHaveValue(4),
      { timeout: 5000 },
    );
  }, 15000);

  it("задача отчёта прежнего ребёнка к новому не переходит, вкладка остаётся", async () => {
    // Иначе экран отчёта второго ребёнка показывал готовность и ссылку на PDF
    // первого.
    renderIn(
      "reports",
      { patient: FIRST, job: "job-1", tab: "pdf" },
      <>
        <PatientSwitcher />
        <SearchProbe />
      </>,
    );
    expect(await screen.findByTestId("search")).toHaveTextContent(
      `${FIRST}|job-1||pdf`,
    );

    await switchTo(SECOND);

    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(`${SECOND}|||pdf`),
    );
  });

  it("своё блюдо прежнего ребёнка к новому не переходит", async () => {
    // Своё блюдо принадлежит ребёнку: в калькуляторе другого оно не должно
    // открыться.
    renderIn(
      "calculator",
      { patient: FIRST, item: "dish:1" },
      <>
        <PatientSwitcher />
        <SearchProbe />
      </>,
    );
    expect(await screen.findByTestId("search")).toHaveTextContent(
      `${FIRST}||dish:1|`,
    );

    await switchTo(SECOND);

    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(`${SECOND}|||`),
    );
  });

  it("открытый рецепт от смены ребёнка не закрывается", async () => {
    // Рецепт общий, от ребёнка не зависит: смена в шапке не должна закрывать
    // его карточку.
    renderIn(
      "recipes",
      { patient: FIRST, item: "r1" },
      <>
        <PatientSwitcher />
        <SearchProbe />
      </>,
    );
    expect(await screen.findByTestId("search")).toHaveTextContent(
      `${FIRST}||r1|`,
    );

    await switchTo(SECOND);

    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(`${SECOND}||r1|`),
    );
  });

  it("первый выбор ребёнка не теряет рецепт, пришедший ссылкой «В калькулятор»", async () => {
    // Ребёнок ещё не выбран, гейт просит выбрать — а в адресе уже рецепт.
    // После выбора он обязан остаться: за ним человек и пришёл.
    const user = userEvent.setup();
    renderIn(
      "calculator",
      { item: "recipe:r1" },
      <>
        <PatientGate render={() => <p>экран ребёнка</p>} />
        <SearchProbe />
      </>,
    );

    await user.click(await screen.findByRole("button", { name: "Ребёнок 2" }));

    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(
        `${SECOND}||recipe:r1|`,
      ),
    );
  });
});
