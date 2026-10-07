import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import diaryRu from "../../locales/ru/diary.json";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { PatientDiaryTab } from "./PatientDiaryTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);
i18n.addResourceBundle("ru", "diary", diaryRu, true, true);

describe("дневник в карте пациента", () => {
  it("пустой дневник — повод напомнить семье, а не тупик (ADR-0046)", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<PatientDiaryTab patientId="p1" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <PatientRouter patientId="p1" view="diary">
            {children}
          </PatientRouter>
        </QueryClientProvider>
      ),
    });

    expect(await screen.findByText(doctorRu.diary.empty)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: doctorRu.nudge.action }),
    ).toBeInTheDocument();
  });
});

describe("период дневника в карте — в адресе", () => {
  it("F5 возвращает выбранный врачом период", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<PatientDiaryTab patientId="p1" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <PatientRouter
            patientId="p1"
            view="diary"
            search={{ period: "week" }}
          >
            {children}
          </PatientRouter>
        </QueryClientProvider>
      ),
    });

    // У врача умолчание — месяц; неделя пришла из адреса.
    expect(await screen.findByRole("radio", { name: "Неделя" })).toBeChecked();
  });
});
