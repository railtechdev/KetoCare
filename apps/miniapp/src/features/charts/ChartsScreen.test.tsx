import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  // `client` — тестам, которым нужно тронуть сам кэш (фоновое обновление).
  const result = render(<ChartsScreen session={SESSION} />, {
    wrapper: Wrapper,
  });
  return Object.assign(result, { client });
}

beforeEach(() => {
  // Иначе будущий тест почистил бы кэш прошлого, ничего об этом не сказав.
  screenClient = undefined;
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

/** Кэш открытого экрана: чистим до возврата сети, чтобы паузы не снимались. */
let screenClient: QueryClient | undefined;

describe("динамика в Mini App", () => {
  it("пауза без сети объясняется словами, а не пустотой", async () => {
    // Тот же случай, что в плане дня: запрос ждёт связи, а график выглядел
    // так, будто записей нет вовсе.
    (api.GET as Mock).mockImplementation(() => new Promise(() => undefined));
    onlineManager.setOnline(false);

    try {
      const { client } = renderScreen();
      screenClient = client;

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      // Один раз на экран, а не по разу на каждый график: две одинаковые
      // фразы подряд — это тот же текст дважды (правило П27).
      expect(
        screen.getAllByText("Нет связи — покажем, как только она появится."),
      ).toHaveLength(1);
      // И ни один график не утверждает, что записей нет: это было бы третье
      // утверждение об одном и том же, вдобавок ложное.
      expect(screen.queryAllByText("Записей за этот период нет.")).toHaveLength(
        0,
      );
      expect(api.GET).not.toHaveBeenCalled();
    } finally {
      screenClient?.clear();
      onlineManager.setOnline(true);
    }
  });

  it("показывает оба показателя", async () => {
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Кетоны" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Вес" })).toBeInTheDocument();
  });

  it("пустой ответ — это «записей нет», а не молчание блока", async () => {
    // Блок молчит, только пока ответа нет. Если сервер ответил и записей за
    // месяц действительно нет, это надо сказать: иначе экран одинаково молчит
    // и когда связи нет, и когда ребёнок месяц не измерялся.
    (api.GET as Mock).mockResolvedValue({
      data: { items: [], total: 0 },
    });

    renderScreen();

    expect(
      await screen.findAllByText("Записей за этот период нет."),
    ).toHaveLength(2);
  });

  it("с записями рисует графики и молчит про пустоту", async () => {
    renderScreen();

    expect(await screen.findAllByRole("figure")).toHaveLength(2);
    expect(screen.queryByText("Записей за этот период нет.")).toBeNull();
    expect(
      screen.queryByText("Нет связи — покажем, как только она появится."),
    ).toBeNull();
  });

  it("над нарисованными графиками про связь не говорит", async () => {
    // Фоновое обновление без сети тоже встаёт на паузу. Сообщать о связи там,
    // где данные уже на экране, значит говорить о том, что и так видно, — и
    // отнимать место у самих графиков на телефоне.
    const { client } = renderScreen();
    screenClient = client;
    expect(await screen.findAllByRole("figure")).toHaveLength(2);

    onlineManager.setOnline(false);
    try {
      act(() => {
        void client.refetchQueries();
      });

      await waitFor(() => {
        expect(
          client.getQueryCache().findAll({ fetchStatus: "paused" }).length,
        ).toBeGreaterThan(0);
      });
      expect(
        screen.queryByText("Нет связи — покажем, как только она появится."),
      ).toBeNull();
    } finally {
      screenClient?.clear();
      onlineManager.setOnline(true);
    }
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
