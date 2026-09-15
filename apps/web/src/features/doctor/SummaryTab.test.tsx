import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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
      GET: vi.fn().mockImplementation(() =>
        Promise.resolve({
          data: {
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
            family_activated: true,
          } satisfies PatientOverview,
        }),
      ),
    },
  };
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
      });
  });
});
