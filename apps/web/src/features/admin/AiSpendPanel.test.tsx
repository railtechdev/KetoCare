import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import type { SectionSearch } from "../../routes/search";
import { SectionRouter } from "../../test/SectionRouter";
import { AiSpendPanel } from "./AiSpendPanel";
import type { AiSpendReport, AssistantSpeedReport } from "./useAiSettings";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

function line(cost: string, calls: number, failed = 0, failedCost = "0") {
  return {
    calls,
    failed_calls: failed,
    unpriced_calls: 0,
    cost_usd: cost,
    failed_cost_usd: failedCost,
    tokens_in: calls * 1000,
    tokens_out: calls * 200,
  };
}

const REPORT: AiSpendReport = {
  period: "week",
  since: "2026-11-08T19:00:00Z",
  totals: { ...line("2.76", 5, 1, "0.5"), unpriced_calls: 1 },
  by_group: [
    { group: "technical", ...line("2.5", 3, 1, "0.5") },
    { group: "specialists", ...line("0", 0) },
    { group: "families", ...line("0.26", 2) },
  ],
  by_kind: [
    { kind: "recipe_import", group: "technical", ...line("2.5", 2, 1, "0.5") },
  ],
  by_model: [{ model: "claude-opus-5", ...line("2.75", 4, 1, "0.5") }],
  people: [
    {
      user_id: "u-1",
      full_name: "Диетолог Тестовая",
      role: "dietitian",
      search: "diet@example.com",
      is_active: true,
      calls: 3,
      failed_calls: 1,
      cost_usd: "2.5",
      groups: ["technical"],
    },
  ],
  people_total: 60,
  people_limit: 50,
};

const SPEED: AssistantSpeedReport = {
  period: "week",
  since: "2026-11-08T19:00:00Z",
  total: { count: 12, median_ms: 6400, p90_ms: 41000, max_ms: 182000 },
  steps: [
    { step: "queue", count: 12, median_ms: 40, p90_ms: 9000, max_ms: 30000 },
    { step: "search", count: 12, median_ms: 25, p90_ms: 60, max_ms: 90 },
    { step: "model", count: 9, median_ms: 6100, p90_ms: 30000, max_ms: 180000 },
  ],
  by_model: [
    {
      model: "anthropic/claude-opus-5",
      count: 9,
      median_ms: 6100,
      p90_ms: 30000,
      max_ms: 180000,
    },
  ],
  outcomes: [
    { outcome: "answered", count: 9 },
    { outcome: "no_material", count: 3 },
  ],
};

function mockReports(spend: AiSpendReport, speed: AssistantSpeedReport) {
  (api.GET as Mock).mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith("/assistant-speed") ? speed : spend,
    }),
  );
}

function renderPanel(search: SectionSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="ai" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<AiSpendPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReports(REPORT, SPEED);
});

describe("расход на модели", () => {
  it("берёт период из адреса", async () => {
    renderPanel({ tab: "spend", kind: "week" });

    await screen.findByText("Кто потратил больше всех");
    expect(api.GET).toHaveBeenCalledWith("/api/v1/admin/ai/spend", {
      params: { query: { period: "week" } },
    });
  });

  it("называет неудачные обращения и их цену отдельно", async () => {
    renderPanel();

    await screen.findByText("По группам задач");
    // Первая строка с группой — таблица групп; в таблице задач группа стоит
    // второй строкой под названием задачи.
    const [first] = screen.getAllByText("Технические работы");
    const technical = first?.closest("tr") as HTMLElement;
    expect(within(technical).getByText("1 · $0,50")).toBeInTheDocument();
    expect(within(technical).getByText("$2,50")).toBeInTheDocument();
    // Оборвавшееся обращение выпадает из суммы — это сказано вслух.
    expect(screen.getByText(/без известной стоимости: 1/)).toBeInTheDocument();
  });

  it("ведёт от человека к его учётной записи и говорит, что список урезан", async () => {
    renderPanel();

    const link = await screen.findByRole("link", { name: "Диетолог Тестовая" });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("q=diet%40example.com"),
    );
    expect(screen.getByText("Показаны 1 из 60.")).toBeInTheDocument();
  });

  it("пустой период — не таблица нулей", async () => {
    mockReports(
      { ...REPORT, totals: line("0", 0), people: [], people_total: 0 },
      SPEED,
    );
    renderPanel({ kind: "day" });

    expect(
      await screen.findByText("Обращений к моделям не было"),
    ).toBeInTheDocument();
    expect(screen.queryByText("По группам задач")).not.toBeInTheDocument();
  });
});

describe("скорость помощника", () => {
  it("показывает шаги по порядку, обычный и плохой случай", async () => {
    renderPanel({ tab: "spend", kind: "week" });

    await screen.findByText("Скорость помощника");
    expect(api.GET).toHaveBeenCalledWith("/api/v1/admin/ai/assistant-speed", {
      params: { query: { period: "week" } },
    });
    const model = (await screen.findAllByText("Модель"))
      .map((cell) => cell.closest("tr"))
      .find((row) => row?.querySelector("th[scope=row]")) as HTMLElement;
    expect(within(model).getByText("6,1 с")).toBeInTheDocument();
    expect(within(model).getByText("30 с")).toBeInTheDocument();
    const search = screen
      .getByText("Поиск по статьям")
      .closest("tr") as HTMLElement;
    expect(within(search).getByText("25 мс")).toBeInTheDocument();
    // Опрос экрана сервер не видит — это сказано отдельно.
    expect(screen.getByText(/до 2,5 с: экран проверяет/)).toBeInTheDocument();
    expect(
      screen.getByText(/ответ — 9, нет материала \(модель не вызывалась\) — 3/),
    ).toBeInTheDocument();
  });

  it("без ответов — пустое состояние, а не нули", async () => {
    mockReports(REPORT, {
      ...SPEED,
      total: null,
      steps: [],
      by_model: [],
      outcomes: [],
    });
    renderPanel();

    expect(
      await screen.findByText("Помощник ещё не отвечал"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Поиск по статьям")).not.toBeInTheDocument();
  });
});
