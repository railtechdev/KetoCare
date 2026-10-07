import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import reportsRu from "../../locales/ru/reports.json";
import { SectionRouter } from "../../test/SectionRouter";
import { ReportsView } from "./ReportsView";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u1", role: "parent" } }),
}));

i18n.addResourceBundle("ru", "reports", reportsRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

const REPORT = {
  patient_id: PATIENT_ID,
  from: "2026-08-01",
  to: "2026-08-31",
  seizures: { total: 0, entries: 0, by_type: [] },
  ketones: { points: [], min: null, max: null, mean: null },
  weight: { points: [], min: null, max: null, mean: null },
  menu: { days: 0, items: 0, eaten: 0 },
  summaries: [],
};

let jobStatus = "queued";
let jobPatient = PATIENT_ID;

function renderView(search: Record<string, string> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Роутер обязателен: задача сборки PDF живёт в адресе (`?job=`), а не в
  // состоянии экрана — иначе готовый файл теряется при обновлении страницы.
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="reports" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ReportsView patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  jobStatus = "queued";
  jobPatient = PATIENT_ID;
  (api.GET as Mock).mockImplementation((path: string) =>
    path.includes("/reports/jobs/")
      ? Promise.resolve({
          data: {
            id: "job1",
            patient_id: jobPatient,
            status: jobStatus,
            created_at: new Date().toISOString(),
          },
        })
      : Promise.resolve({ data: REPORT }),
  );
  (api.POST as Mock).mockResolvedValue({
    data: { id: "job1", status: "queued" },
  });
});

describe("сборка PDF-отчёта", () => {
  it("у отказа есть выход: собрать заново", async () => {
    // Раньше здесь была одна красная строка без действия: человек не мог ни
    // повторить, ни понять, ждать ли (правило П16 канона).
    jobStatus = "failed";
    const user = userEvent.setup();
    renderView();

    await user.click(
      await screen.findByRole("button", { name: /Собрать PDF/ }),
    );

    const retry = await screen.findByRole("button", { name: "Собрать заново" });
    await user.click(retry);

    await waitFor(() => {
      // Первый запрос — постановка, второй — повтор.
      expect((api.POST as Mock).mock.calls.length).toBe(2);
    });
  });

  it("пока задача в очереди, обещает файл", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      await screen.findByRole("button", { name: /Собрать PDF/ }),
    );

    expect(await screen.findByText(reportsRu.pdf.building)).toBeInTheDocument();
  });

  it("задача другого пациента из адреса — не скачивается и не опрашивается", async () => {
    // `?job=` остался от карты соседнего ребёнка: прежде экран опрашивал её
    // бесконечно или отдавал чужой файл.
    jobPatient = "99999999-9999-4999-8999-999999999999";
    jobStatus = "done";
    renderView({ job: "job1" });

    expect(await screen.findByText(reportsRu.pdf.lost)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Скачать PDF/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Собрать заново" }),
    ).toBeInTheDocument();
  });

  it("исчезнувшая задача — сообщение и выход, а не вечное «собираем»", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      path.includes("/reports/jobs/")
        ? Promise.resolve({
            error: {
              error: { code: "not_found", message: "Нет такой задачи." },
            },
          })
        : Promise.resolve({ data: REPORT }),
    );
    const user = userEvent.setup();
    renderView({ job: "gone" });

    expect(await screen.findByText(reportsRu.pdf.lost)).toBeInTheDocument();
    expect(screen.queryByText(reportsRu.pdf.building)).toBeNull();
    const jobCalls = () =>
      (api.GET as Mock).mock.calls.filter(([path]) =>
        String(path).includes("/reports/jobs/"),
      ).length;
    expect(jobCalls()).toBe(1);

    await user.click(screen.getByRole("button", { name: "Убрать" }));
    await waitFor(() =>
      expect(screen.queryByText(reportsRu.pdf.lost)).toBeNull(),
    );
  });
});
