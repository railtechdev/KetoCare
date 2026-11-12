import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import type { SectionSearch } from "../../routes/search";
import { currentAddress } from "../../test/address";
import { SectionRouter } from "../../test/SectionRouter";
import { LeadsPanel } from "./LeadsPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const leadsRu = adminRu.leads;

const FRESH = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "mama@example.com",
  audience: "family",
  locale: "uz-Latn-UZ",
  created_at: "2026-11-12T09:00:00Z",
  processed_at: null,
};
const ANSWERED = {
  ...FRESH,
  id: "22222222-2222-4222-8222-222222222222",
  email: "doctor@example.com",
  audience: "doctor",
  locale: "en",
  processed_at: "2026-11-12T10:00:00Z",
};

function renderPanel(search: SectionSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="leads" search={search}>
          {children}
        </SectionRouter>
        <Toaster />
      </QueryClientProvider>
    );
  }
  return render(<LeadsPanel chrome="screen" />, { wrapper: Wrapper });
}

function rowOf(email: string): HTMLElement {
  return screen.getByText(email).closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(
    (_path: string, options: { params: { query: { status?: string } } }) => {
      const status = options.params.query.status;
      const items =
        status === "new"
          ? [FRESH]
          : status === "processed"
            ? [ANSWERED]
            : [FRESH, ANSWERED];
      return Promise.resolve({ data: { items, total: items.length } });
    },
  );
});

describe("заявки с сайта (ADR-0072)", () => {
  it("по умолчанию показывает новые и называет язык словом", async () => {
    renderPanel();

    expect(await screen.findByText(FRESH.email)).toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/leads",
      expect.objectContaining({
        params: { query: expect.objectContaining({ status: "new" }) },
      }),
    );
    // Название языка, а не код «uz-Latn-UZ».
    expect(
      within(rowOf(FRESH.email)).getByText(leadsRu.locales["uz-Latn-UZ"]),
    ).toBeInTheDocument();
    expect(
      within(rowOf(FRESH.email)).getByText(leadsRu.status.new),
    ).toBeInTheDocument();
    expect(screen.queryByText(ANSWERED.email)).toBeNull();
  });

  it("отбор живёт в адресе: «Все» показывает и обработанные", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(FRESH.email);

    await user.click(screen.getByRole("radio", { name: leadsRu.views.all }));

    expect(await screen.findByText(ANSWERED.email)).toBeInTheDocument();
    expect(currentAddress()).toMatchObject({ tab: "all" });
    expect(
      within(rowOf(ANSWERED.email)).getByText(leadsRu.status.processed),
    ).toBeInTheDocument();
    expect(
      within(rowOf(ANSWERED.email)).getByText(leadsRu.locales.en),
    ).toBeInTheDocument();
  });

  it("отмечает заявку обработанной одним нажатием", async () => {
    (api.PATCH as Mock).mockResolvedValue({
      data: { ...FRESH, processed_at: "2026-11-12T11:00:00Z" },
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(FRESH.email);

    await user.click(
      screen.getByRole("button", {
        name: leadsRu.markProcessedAria.replace("{{email}}", FRESH.email),
      }),
    );

    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith("/api/v1/leads/{lead_id}", {
        params: { path: { lead_id: FRESH.id } },
        body: { processed: true },
      }),
    );
    expect(
      await screen.findByText(
        leadsRu.markedProcessed.replace("{{email}}", FRESH.email),
      ),
    ).toBeInTheDocument();
  });

  it("обработанную можно вернуть в новые", async () => {
    (api.PATCH as Mock).mockResolvedValue({
      data: { ...ANSWERED, processed_at: null },
    });
    const user = userEvent.setup();
    renderPanel({ tab: "processed" });
    await screen.findByText(ANSWERED.email);

    await user.click(
      screen.getByRole("button", {
        name: leadsRu.markNewAria.replace("{{email}}", ANSWERED.email),
      }),
    );

    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith("/api/v1/leads/{lead_id}", {
        params: { path: { lead_id: ANSWERED.id } },
        body: { processed: false },
      }),
    );
  });

  it("новых нет — так и сказано, а не «заявок пока нет»", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderPanel();

    expect(await screen.findByText(leadsRu.emptyNew)).toBeInTheDocument();
    expect(screen.queryByText(leadsRu.empty)).toBeNull();
  });
});
