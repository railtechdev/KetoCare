import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { api } from "../../lib/api";
import { PatientRouter } from "../../test/PatientRouter";
import { SummaryTab } from "./SummaryTab";
import type { Patient, PatientOverview } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      GET: vi.fn().mockImplementation((path: string) =>
        Promise.resolve({
          data: path.endsWith("/report")
            ? report
            : ({
                patient_id: PATIENT.id,
                date: "2026-09-01",
                prescription: null,
                day: null,
                last_ketone: null,
                last_weight: null,
                seizures_today: { entries: 0, count: 0 },
                seizure_trend: {
                  recent: 0,
                  previous: 0,
                  grew: null,
                  appeared: false,
                },
                last_reading_on: null,
                monitoring_phase: "routine",
                family_activated: familyActivated,
              } satisfies PatientOverview),
        }),
      ),
    },
  };
});

let familyActivated = true;

/** Отчёт за 30 дней — источник блока «За 30 дней». */
let report: Record<string, unknown> = emptyReport();

function emptyReport(): Record<string, unknown> {
  return {
    generated_at: "2026-09-01T10:00:00Z",
    period: { from_date: "2026-08-03", to_date: "2026-09-01" },
    patient: {},
    prescriptions: [],
    seizures: { entries: 0, count: 0, by_type: [], by_day: {} },
    ketones: { points: [], min: null, max: null, mean: null },
    weight: { points: [], min: null, max: null, mean: null },
    medications: [],
    side_effects: [],
    menu: { days_planned: 0, items_planned: 0, items_eaten: 0 },
    summaries: [],
  };
}

beforeEach(() => {
  familyActivated = true;
  report = emptyReport();
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT: Patient = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Аня Иванова",
  birth_date: "2019-04-12",
  sex: "f",
  height_cm: 104,
  allergies: [],
  allergy_labels: [],
  excluded_products: [],
  notes: null,
  family_activated: true,
};

function renderSummary() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PatientRouter patientId={PATIENT.id} view="summary">
          {children}
        </PatientRouter>
      </QueryClientProvider>
    );
  }

  return render(<SummaryTab patient={PATIENT} />, {
    wrapper: Wrapper,
  });
}

describe("сводка пациента", () => {
  it("из «назначения нет» ведёт в раздел назначения ссылкой", async () => {
    // Текст звал на соседнюю вкладку, а перейти на неё нажатием было нельзя.
    // Теперь это ссылка, а не смена вкладки: раздел живёт по адресу (П1), и
    // врач открывает его в новой вкладке и пересылает коллеге.
    renderSummary();

    const link = await screen.findByRole("link", {
      name: "Задать назначение",
    });
    expect(link.getAttribute("href")).toBe(
      `/app/patients/${PATIENT.id}/prescription`,
    );
  });

  it("из пустого дня ведёт составить его (ADR-0047)", async () => {
    // Прежде текст обещал итоги, «когда семья запланирует», — хотя
    // специалист составляет день тем же экраном, что и семья.
    renderSummary();

    const link = await screen.findByRole("link", { name: "Составить день" });
    expect(link.getAttribute("href")).toBe(`/app/patients/${PATIENT.id}/menu`);
  });

  it("не показывает анамнез: он живёт в разделе «Профиль»", async () => {
    // Сводка отвечает на вопрос «что с ребёнком сейчас». Шесть блоков анкеты,
    // документов и контактов под ней превращали ответ в пролистывание.
    renderSummary();

    await screen.findByRole("link", { name: "Задать назначение" });
    expect(screen.queryByText("Анкета")).not.toBeInTheDocument();
    expect(screen.queryByText("Данные пациента")).not.toBeInTheDocument();
  });

  it("день без соотношения не выдаётся врачу за соответствие назначению", () => {
    // Ревью #214: убрав красную пометку, я едва не поставил на её место зелёное
    // утверждение — `null` падал в утвердительную ветку, и врач читал бы
    // «соответствует назначению» про день, о котором ядро молчит.
    vi.mocked(api.GET).mockResolvedValueOnce({
      data: {
        patient_id: PATIENT.id,
        date: "2026-09-01",
        prescription: {
          id: "rx1",
          patient_id: PATIENT.id,
          ratio: 3.5,
          kcal_per_day: 1200,
          protein_g: 12,
          carbs_limit_g: 35,
          meals_per_day: 4,
          restrictions: null,
          author_id: "u1",
          effective_from: "2026-08-01",
          created_at: "2026-08-01T10:00:00Z",
        },
        day: {
          totals: {
            kcal: 1200,
            fat: 100,
            protein: 24,
            carbs: 10,
            fiber: 10,
            ratio: null,
          },
          tolerance: {
            ratio_within_tolerance: null,
            kcal_within_tolerance: true,
            carbs_within_limit: true,
          },
          tolerance_gap: null,
          engine_version: "1.2.0",
        },
        last_ketone: null,
        last_weight: null,
        seizures_today: { entries: 0, count: 0 },
        seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
        last_reading_on: null,
        monitoring_phase: "routine",
        family_activated: true,
      } satisfies PatientOverview,
    } as never);

    renderSummary();

    return screen
      .findByText(doctorRu.summary.day.ratioUnknown)
      .then((neutral) => {
        expect(neutral).toBeInTheDocument();
        expect(
          screen.queryByText(doctorRu.summary.day.within),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(doctorRu.summary.day.offRatio),
        ).not.toBeInTheDocument();
        // Жидкость не задана — строки о ней нет (ADR-0069).
        expect(screen.queryByText(doctorRu.fields.fluid)).toBeNull();
        // The active prescription leads to its form: the dietitian looked
        // for a way to change it from the overview and found none.
        const edit = screen.getByRole("link", {
          name: doctorRu.summary.prescription.edit,
        });
        expect(edit.getAttribute("href")).toBe(
          `/app/patients/${PATIENT.id}/prescription`,
        );
      });
  });

  it("показывает жидкость, если врач её задал (ADR-0069)", async () => {
    vi.mocked(api.GET).mockResolvedValueOnce({
      data: {
        patient_id: PATIENT.id,
        date: "2026-09-01",
        prescription: {
          id: "rx1",
          patient_id: PATIENT.id,
          ratio: 3.5,
          kcal_per_day: 1200,
          protein_g: 12,
          carbs_limit_g: 35,
          meals_per_day: 4,
          fluid_ml_per_day: 1400,
          restrictions: null,
          author_id: "u1",
          effective_from: "2026-08-01",
          created_at: "2026-08-01T10:00:00Z",
        },
        day: null,
        last_ketone: null,
        last_weight: null,
        seizures_today: { entries: 0, count: 0 },
        seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
        last_reading_on: null,
        monitoring_phase: "routine",
        family_activated: true,
      } satisfies PatientOverview,
    } as never);

    renderSummary();

    expect(await screen.findByText(doctorRu.fields.fluid)).toBeInTheDocument();
    expect(screen.getByText(/1\s?400 мл в сутки/)).toBeInTheDocument();
  });

  it("неподключённая семья — одна строка с действием «Выдать код»", async () => {
    familyActivated = false;
    renderSummary();

    expect(
      await screen.findByText(doctorRu.summary.family.notConnected),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: doctorRu.summary.family.issueCode,
    });
    // Панель кода открывается сразу — параметром адреса раздела профиля.
    expect(link.getAttribute("href")).toBe(
      `/app/patients/${PATIENT.id}/profile?item=access-code`,
    );
  });

  it("подключённая семья строки не получает", async () => {
    renderSummary();

    await screen.findByRole("link", { name: "Задать назначение" });
    expect(
      screen.queryByText(doctorRu.summary.family.notConnected),
    ).not.toBeInTheDocument();
  });

  it("за 30 дней: приступы, кетоны и вес — крайние и последние, съеденное", async () => {
    report = {
      ...emptyReport(),
      seizures: {
        entries: 2,
        count: 5,
        by_type: [],
        by_day: { [new Date().toISOString().slice(0, 10)]: 5 },
      },
      ketones: {
        points: [
          { at: "2026-08-20T08:00:00Z", value: 1.4 },
          { at: "2026-08-30T08:00:00Z", value: 2.7 },
          { at: "2026-08-25T08:00:00Z", value: 3.1 },
        ],
        min: 1.4,
        max: 3.1,
        mean: 2.4,
      },
      weight: {
        points: [
          { at: "2026-08-30T08:00:00Z", value: 18.6 },
          { at: "2026-08-05T08:00:00Z", value: 18.2 },
        ],
        min: 18.2,
        max: 18.6,
        mean: 18.4,
      },
      menu: { days_planned: 10, items_planned: 40, items_eaten: 34 },
    };
    renderSummary();

    expect(
      await screen.findByRole("heading", {
        name: doctorRu.summary.month.title,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("5 приступов")).toBeInTheDocument();
    expect(screen.getByText("1,4–3,1")).toBeInTheDocument();
    // Последний — по времени, а не по порядку в ответе.
    expect(screen.getByText(/последний 2,7/)).toBeInTheDocument();
    expect(screen.getByText("18,2 → 18,6")).toBeInTheDocument();
    expect(screen.getByText("34 из 40 блюд")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: doctorRu.summary.month.toReport }),
    ).toHaveAttribute("href", `/app/patients/${PATIENT.id}/reports`);
  });

  it("за 30 дней без записей пишет это словами", async () => {
    renderSummary();

    expect(
      await screen.findAllByText(doctorRu.summary.month.noReadings),
    ).toHaveLength(2);
    expect(screen.getByText(doctorRu.summary.month.noMenu)).toBeInTheDocument();
  });
});
