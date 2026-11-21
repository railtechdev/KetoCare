import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { toDateInput } from "@ketocare/ui";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { MedicationScheme } from "./MedicationScheme";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: false,
};

function shifted(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function medication(overrides: Record<string, unknown>) {
  return {
    id: "m",
    drug_name: "Препарат",
    dose: "250 мг",
    frequency_code: "twice_daily",
    frequency: null,
    started_at: shifted(-30),
    stopped_at: null,
    ...overrides,
  };
}

function renderScheme(onBack = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(
    <MedicationScheme session={SESSION} backLabel="Сегодня" onBack={onBack} />,
    { wrapper: Wrapper },
  );
  return onBack;
}

function serve(items: unknown[]) {
  (api.GET as Mock).mockImplementation(async () => ({
    data: { items, total: items.length },
    response: { status: 200 },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Р4 аудита Mini App: схема препаратов на чтение для семьи без кабинета —
 * теми же словами, что лист «Схема приёма препаратов» кабинета.
 */
describe("схема препаратов", () => {
  it("каждый препарат — с дозой, кратностью словами и сроком", async () => {
    serve([
      medication({
        id: "a",
        drug_name: "Топирамат",
        frequency: "утром и на ночь",
      }),
      medication({
        id: "b",
        drug_name: "Вальпроат",
        stopped_at: shifted(10),
      }),
      medication({
        id: "c",
        drug_name: "Клобазам",
        started_at: shifted(5),
        dose: "5 мг",
        frequency_code: "once_daily",
      }),
    ]);
    renderScheme();

    const rows = await screen.findAllByRole("listitem");
    // По алфавиту — как на листе.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(
        /^Вальпроат · 250 мг2 раза в суткидо .+ включительно$/,
      ),
      expect.stringMatching(/^Клобазам · 5 мг1 раз в суткис \d/),
      expect.stringMatching(
        /^Топирамат · 250 мг2 раза в сутки — утром и на ночьпринимается$/,
      ),
    ]);
    expect(
      screen.getByText(
        "Не меняйте дозу сами: схему меняет только лечащий врач.",
      ),
    ).toBeInTheDocument();
  });

  it("отменённый препарат не показывается: схема — что давать", async () => {
    serve([
      medication({ id: "a", drug_name: "Топирамат" }),
      medication({
        id: "b",
        drug_name: "Вальпроат",
        stopped_at: shifted(-1),
      }),
    ]);
    renderScheme();

    const list = await screen.findByRole("list");
    expect(within(list).getByText("Топирамат")).toBeInTheDocument();
    expect(screen.queryByText("Вальпроат")).not.toBeInTheDocument();
  });

  it("препаратов нет — так и сказано", async () => {
    serve([]);
    renderScheme();

    expect(
      await screen.findByText("Препаратов в схеме нет."),
    ).toBeInTheDocument();
  });

  it("«Назад» ведёт туда, откуда открыли", async () => {
    serve([]);
    const user = userEvent.setup();
    const onBack = renderScheme();

    await user.click(screen.getByRole("button", { name: "Сегодня" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
