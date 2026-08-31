import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { ChartsScreen } from "./ChartsScreen";
import { trendRange } from "./useTrend";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
};

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ChartsScreen session={SESSION} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("prescriptions")) {
      return Promise.resolve({
        data: { items: [{ ratio: 4, effective_from: "2026-08-01" }], total: 1 },
      });
    }
    return Promise.resolve({
      data: {
        items: [
          { occurred_at: "2026-08-30T07:30:00Z", value: 3.2, weight_kg: 18.4 },
        ],
        total: 1,
      },
    });
  });
});

describe("динамика в Mini App", () => {
  it("показывает оба показателя", async () => {
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Кетоны" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Вес" })).toBeInTheDocument();
  });

  it("без истории назначений говорит, что черт нет", async () => {
    // График без вертикальных черт молча врёт: скачок после смены соотношения
    // читается как ухудшение состояния.
    (api.GET as Mock).mockImplementation((path: string) =>
      path.includes("prescriptions")
        ? Promise.resolve({ error: { detail: "нет" } })
        : Promise.resolve({ data: { items: [], total: 0 } }),
    );

    renderScreen();

    expect(
      await screen.findByText(/Без неё скачок показателя/),
    ).toBeInTheDocument();
  });

  it("просит период у сервера, а не режет выдачу на клиенте", async () => {
    renderScreen();

    const range = trendRange();
    await screen.findByRole("heading", { name: "Кетоны" });
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/logs/ketones",
      expect.objectContaining({
        params: expect.objectContaining({
          query: expect.objectContaining({ from: range.from, to: range.to }),
        }),
      }),
    );
  });
});

describe("границы периода", () => {
  it("тридцать дней назад, а не месяц назад по календарю", () => {
    // «Месяц назад» в феврале и в июле — разные отрезки, и сравнивать соседние
    // выдачи было бы нечем.
    const range = trendRange(new Date(2026, 2, 15, 10, 0));

    // Сравнение по местному календарю, а не по строке: строка в UTC, и в поясе
    // восточнее Гринвича местная полночь 14 февраля — это 13-е по UTC.
    const from = new Date(range.from);
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([
      2026, 1, 14,
    ]);
  });

  it("отдаёт моменты с поясом, а не даты", () => {
    // Ручка дневника голую дату отклоняет: «Input should have timezone info».
    // Экран из-за этого показывал ошибку загрузки на обоих графиках.
    const range = trendRange(new Date(2026, 2, 15, 10, 0));

    expect(range.from).toMatch(/T.*Z$/);
    expect(range.to).toMatch(/T.*Z$/);
  });

  it("верхняя граница — конец сегодняшнего дня, а не текущий момент", () => {
    // Иначе замер, сделанный вечером после открытия экрана, в период не попал бы.
    const range = trendRange(new Date(2026, 2, 15, 10, 0));

    expect(new Date(range.to).getHours()).toBe(23);
  });
});
