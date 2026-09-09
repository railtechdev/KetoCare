import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { SummaryTab } from "./SummaryTab";

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
          },
        }),
      ),
    },
  };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Аня Иванова",
  birth_date: "2019-04-12",
  sex: "f",
  height_cm: 104,
  allergies: [],
  notes: null,
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

  return render(<SummaryTab patient={PATIENT as never} />, {
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
});
