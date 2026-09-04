import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import commonRu from "../../locales/ru/common.json";
import reportsRu from "../../locales/ru/reports.json";
import { DoctorSummaryPanel } from "./DoctorSummaryPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "reports", reportsRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const RANGE = { from: "2026-08-01", to: "2026-08-31" };

const DRAFT_TEXT = "## Приступы\nЗа период записано 6 приступов.";
// Текст многострочный, и testing-library схлопывает переносы: ищем по
// фрагменту, а не по строке целиком.
const DRAFT_LINE = /За период записано 6 приступов/;

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    patient_id: PATIENT_ID,
    period_start: RANGE.from,
    period_end: RANGE.to,
    status: "done",
    draft_md: DRAFT_TEXT,
    approved_md: null,
    approved_by: null,
    approved_at: null,
    error: null,
    checks: [],
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <DoctorSummaryPanel
      patientId={PATIENT_ID}
      range={RANGE}
      disabled={false}
    />,
    { wrapper: Wrapper },
  );
}

function serves(rows: unknown[]) {
  (api.GET as Mock).mockResolvedValue({ data: rows });
}

beforeEach(() => {
  vi.clearAllMocks();
  serves([]);
  (api.POST as Mock).mockResolvedValue({ data: summary({ status: "queued" }) });
});

describe("черновик сводки", () => {
  it("без сводки предлагает собрать черновик", async () => {
    renderPanel();

    expect(
      await screen.findByText(reportsRu.summary.empty.title),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: reportsRu.summary.request }),
    ).toBeEnabled();
  });

  it("пометка «черновик ИИ» стоит рядом с текстом и связана с ним", async () => {
    /* Пометку нельзя отделить от текста прокруткой, и скринридер читает её
       вместе с ним: иначе утверждение станет механическим нажатием. */
    serves([summary()]);
    renderPanel();

    const notice = (await screen.findByText(reportsRu.summary.notice)).closest(
      "[role='status']",
    );
    const text = screen.getByText(DRAFT_LINE);
    expect(notice?.id).toBeTruthy();
    expect(text).toHaveAttribute("aria-describedby", notice?.id);
  });

  it("пока черновик готовится, говорит об этом и не даёт заказать второй", async () => {
    /* Каждая сборка — платный вызов модели из общего дневного бюджета. */
    serves([summary({ status: "running", draft_md: null })]);
    renderPanel();

    expect(
      await screen.findByText(reportsRu.summary.building),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: reportsRu.summary.again }),
    ).toBeDisabled();
  });

  it("у неудавшейся сборки видна причина", async () => {
    serves([
      summary({
        status: "failed",
        draft_md: null,
        error: "Модель недоступна.",
      }),
    ]);
    renderPanel();

    expect(await screen.findByText("Модель недоступна.")).toBeInTheDocument();
  });

  it("находки постфильтра показаны вместе с текстом, а не вместо него", async () => {
    /* Врач должен отличать «модель написала лишнее» от «система сломалась». */
    serves([
      summary({
        checks: [
          {
            kind: "recommendation",
            rule: "modal",
            fragment: "целесообразно обсудить коррекцию дозы",
            matched: "целесообразн",
            hard: true,
          },
        ],
      }),
    ]);
    renderPanel();

    expect(
      await screen.findByText(reportsRu.summary.checks.kind.recommendation),
    ).toBeInTheDocument();
    expect(screen.getByText(DRAFT_LINE)).toBeInTheDocument();
  });

  it("утверждение проходит через подтверждение и шлёт отредактированный текст", async () => {
    serves([summary()]);
    (api.POST as Mock).mockResolvedValue({
      data: summary({ approved_md: "правленый текст" }),
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: reportsRu.summary.review }),
    );
    const field = screen.getByLabelText(reportsRu.summary.textLabel);
    await user.clear(field);
    await user.type(field, "правленый текст");
    await user.click(
      screen.getByRole("button", { name: reportsRu.summary.approve }),
    );

    // Диалог называет объект и период: врач подтверждает, что понял, что
    // именно уедет в отчёт.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("2026-08-01");
    await user.click(
      within(dialog).getByRole("button", { name: reportsRu.summary.approve }),
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/summaries/{summary_id}/approve",
        expect.objectContaining({
          body: { approved_md: "правленый текст" },
        }),
      );
    });
  });

  it("утверждённая сводка не показывает пометку черновика", async () => {
    serves([
      summary({
        approved_md: DRAFT_TEXT,
        approved_by: "u1",
        approved_at: "2026-09-02T10:00:00Z",
      }),
    ]);
    renderPanel();

    expect(await screen.findByText(DRAFT_LINE)).toBeInTheDocument();
    expect(
      screen.queryByText(reportsRu.summary.notice),
    ).not.toBeInTheDocument();
  });
});
