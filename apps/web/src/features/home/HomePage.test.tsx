import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import homeRu from "../../locales/ru/home.json";
import { SectionRouter } from "../../test/SectionRouter";
import { HomePage } from "./HomePage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "home", homeRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

const PRESCRIPTION = {
  id: "rx1",
  patient_id: PATIENT_ID,
  ratio: 3.5,
  kcal_per_day: 1200,
  protein_g: 12,
  carbs_limit_g: 35,
  meals_per_day: 4,
  starts_on: "2026-08-01",
  created_at: "2026-08-01T10:00:00Z",
};

function overview(prescription: unknown) {
  return {
    patient_id: PATIENT_ID,
    date: "2026-08-31",
    prescription,
    day: null,
    last_ketone: null,
    last_weight: null,
    seizures_today: { entries: 0, count: 0 },
  };
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="home">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }

  return render(<HomePage patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

/**
 * Между «завёл ребёнка» и «врач задал назначение» главная показывала три
 * пустых блока подряд и ни одной подсказки.
 */
describe("главная родителя", () => {
  beforeEach(() => vi.clearAllMocks());

  it("без назначения говорит, чего ждём и что уже можно делать", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: overview(null),
      error: undefined,
    });

    renderHome();

    expect(
      await screen.findByRole("heading", { name: homeRu.waiting.title }),
    ).toBeInTheDocument();
    // Каждая строка ведёт на работающий экран: обещать нечего сверх
    // существующего (правило П3 канона).
    expect(
      screen.getByRole("link", { name: homeRu.waiting.steps.diary.link }),
    ).toHaveAttribute("href", expect.stringContaining("kind=ketones"));
  });

  it("с назначением подсказки нет — она была бы шумом", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: overview(PRESCRIPTION),
      error: undefined,
    });

    renderHome();

    expect(await screen.findByText(/Кетосоотношение/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: homeRu.waiting.title }),
    ).not.toBeInTheDocument();
  });
});
