import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import reportsRu from "../../locales/ru/reports.json";
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

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ReportsView patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  jobStatus = "queued";
  (api.GET as Mock).mockImplementation((path: string) =>
    path.includes("/reports/jobs/")
      ? Promise.resolve({ data: { id: "job1", status: jobStatus } })
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

    await user.click(screen.getByRole("button", { name: /Собрать PDF/ }));

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

    await user.click(screen.getByRole("button", { name: /Собрать PDF/ }));

    expect(await screen.findByText(reportsRu.pdf.building)).toBeInTheDocument();
  });
});
