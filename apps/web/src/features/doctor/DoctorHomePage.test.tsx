import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { SectionRouter } from "../../test/SectionRouter";
import { DoctorHomePage } from "./DoctorHomePage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const SILENT = "11111111-1111-4111-8111-111111111111";
const CALM = "22222222-2222-4222-8222-222222222222";
const BROKEN = "33333333-3333-4333-8333-333333333333";

function patient(id: string, name: string) {
  return {
    id,
    full_name: name,
    birth_date: "2018-05-14",
    sex: "m",
    height_cm: 120,
    allergies: [],
    notes: null,
  };
}

const PATIENTS = {
  items: [
    patient(SILENT, "Молчащий Пациент"),
    patient(CALM, "Спокойный Пациент"),
    patient(BROKEN, "Неизвестный Пациент"),
  ],
  total: 3,
};

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);

function overview(id: string, calm: boolean) {
  return {
    patient_id: id,
    // «Сегодня» берётся из самой сводки, а не с часов браузера: сервер собирает
    // её в часовом поясе установки (`computePatientFlags`).
    date: TODAY,
    prescription: null,
    day: calm
      ? {
          totals: {
            kcal: 1200,
            fat: 100,
            protein: 30,
            carbs: 12,
            fiber: 4,
            ratio: 2.4,
          },
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: true,
          },
        }
      : null,
    // Спокойный пациент: замер сегодня. Молчащий: замеров не было вовсе.
    last_ketone: calm ? { value: 3, occurred_at: NOW.toISOString() } : null,
    last_weight: null,
    seizures_today: { entries: calm ? 1 : 0, count: 0 },
  };
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="home">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }

  return render(<DoctorHomePage />, { wrapper: Wrapper });
}

/**
 * Вход врача вёл сразу в таблицу пациентов — полный реестр вместо ответа на
 * вопрос, с которого начинается рабочий день (`docs/DESIGN_PROPOSAL.md`).
 */
describe("главная врача", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockImplementation(async (_path: string, init: never) => {
      const options = init as unknown as {
        params?: { path?: { patient_id?: string } };
      };
      const id = options?.params?.path?.patient_id;
      if (id === undefined) return { data: PATIENTS, error: undefined };
      if (id === BROKEN) {
        return {
          data: undefined,
          error: { error: { code: "internal", message: "сбой" } },
        };
      }
      return { data: overview(id, id === CALM), error: undefined };
    });
  });

  it("в очередь попадают только помеченные пациенты", async () => {
    renderHome();

    expect(
      await screen.findByRole("link", { name: "Молчащий Пациент" }),
    ).toBeInTheDocument();

    // Спокойного в очереди нет вовсе: очередь отвечает «кем заняться», а не
    // «кто у меня есть» — для второго вопроса существует раздел «Пациенты».
    expect(screen.queryByText("Спокойный Пациент")).not.toBeInTheDocument();
  });

  it("пациента без сводки не выдаёт за спокойного, а считает отдельно", async () => {
    renderHome();

    // Триаж, выдающий «всё хорошо» там, где ничего не известно, — худшая из
    // его ошибок (правило П19 канона). Молчать о таком пациенте нельзя.
    const unknownLabel = await screen.findByText("Сводка не загрузилась");
    const row = unknownLabel.nextElementSibling;
    expect(row?.textContent).toContain("1");

    expect(screen.queryByText("Неизвестный Пациент")).not.toBeInTheDocument();
  });

  it("имя в очереди ведёт в карту этого пациента", async () => {
    renderHome();

    const link = await screen.findByRole("link", { name: "Молчащий Пациент" });
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toBe(
      `/app/patients?patient=${SILENT}`,
    );
  });
});
