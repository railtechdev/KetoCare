import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import diaryRu from "../../locales/ru/diary.json";
import doctorRu from "../../locales/ru/doctor.json";
import { nativeSelect } from "../../test/nativeSelect";
import { PatientRouter } from "../../test/PatientRouter";
import { PatientDiaryTab } from "./PatientDiaryTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "doctor-1" } }),
}));

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

describe("пустой вид дневника называет виды с записями", () => {
  it("нет приступов — кнопка открывает кетоны, где записи есть", async () => {
    // Аудит интерфейса 18.11.2026: «записей нет» при 72 замерах кетонов.
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.endsWith("/logs/ketones")
        ? {
            data: {
              items: [
                {
                  id: "k1",
                  occurred_at: "2026-11-10T08:00:00Z",
                  value: 2.4,
                  method: "blood",
                  source: "web",
                  author_id: "parent-1",
                  note: null,
                },
              ],
              total: 1,
            },
          }
        : { data: { items: [], total: 0 } },
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
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
    const ketones = await screen.findByRole("button", {
      name: "Кетоны — 1 запись",
    });
    expect(
      screen.queryByRole("button", { name: /^Вес —/ }),
    ).not.toBeInTheDocument();

    await user.click(ketones);
    await waitFor(() =>
      expect(
        nativeSelect(screen.getByLabelText(doctorRu.diary.tabsLabel)).value,
      ).toBe("ketones"),
    );
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

describe("запись на приёме", () => {
  function renderKind(kind: string) {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<PatientDiaryTab patientId="p1" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <PatientRouter patientId="p1" view="diary" search={{ kind }}>
            {children}
          </PatientRouter>
        </QueryClientProvider>
      ),
    });
  }

  it("специалист записывает кетоны сам", async () => {
    renderKind("ketones");
    expect(
      await screen.findByRole("button", { name: doctorRu.diary.recordAtVisit }),
    ).toBeInTheDocument();
  });

  it("еду отмечает семья через план дня, а не специалист", async () => {
    renderKind("meals");
    await screen.findByText(doctorRu.diary.empty);
    expect(
      screen.queryByRole("button", { name: doctorRu.diary.recordAtVisit }),
    ).not.toBeInTheDocument();
  });
});

describe("запись, внесённая на приёме (аудит 12.11.2026)", () => {
  function ketone(id: string, createdBy: string) {
    return {
      id,
      patient_id: "p1",
      occurred_at: "2026-11-12T08:00:00Z",
      source: "web",
      created_by: createdBy,
      created_at: "2026-11-12T08:01:00Z",
      value: 2.4,
      method: "blood",
      glucose_mmol: null,
      gki: null,
    };
  }

  it("свою запись специалист может исправить и удалить, чужую — нет", async () => {
    // Раньше список получал вместо пользователя null, и ошибочно внесённую
    // на приёме запись нельзя было ни исправить, ни удалить.
    (api.GET as Mock).mockResolvedValue({
      data: {
        items: [ketone("own", "doctor-1"), ketone("family", "parent-1")],
        total: 2,
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<PatientDiaryTab patientId="p1" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <PatientRouter
            patientId="p1"
            view="diary"
            search={{ kind: "ketones" }}
          >
            {children}
          </PatientRouter>
        </QueryClientProvider>
      ),
    });

    const edits = await screen.findAllByRole("button", {
      name: new RegExp(diaryRu.list.edit),
    });
    expect(edits).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: new RegExp(diaryRu.list.delete) }),
    ).toHaveLength(1);
  });
});
