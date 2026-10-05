import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { HomeScreen } from "./HomeScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: true,
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
  return render(<HomeScreen session={SESSION} />, { wrapper: Wrapper });
}

/**
 * Сводка — по своему адресу, прочее — пустыми списками: близкие и вход в
 * кабинет ходят в свои ручки, и сводка вместо их ответа роняла бы экран.
 */
function serveOverview({ data }: { data: unknown }) {
  (api.GET as Mock).mockImplementation(async (path: string) =>
    path.endsWith("/overview")
      ? { data, response: { status: 200 } }
      : { data: [], response: { status: 200 } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({
    data: {
      patient: { id: SESSION.patientId, full_name: SESSION.patientName },
      prescription: null,
      today: null,
      readings: [],
    },
    response: { status: 200 },
  });
});

describe("сводка в Mini App", () => {
  it("пауза без сети объясняется словами, а не пустотой", async () => {
    // Экран сводки — первое, что видит семья. Без сети запрос не уходит и не
    // отказывает: он ждёт связи и продолжится сам (ADR-0036), а под именем
    // ребёнка оставалась пустота — ни объяснения, ни выхода.
    (api.GET as Mock).mockImplementation(() => new Promise(() => undefined));
    onlineManager.setOnline(false);

    try {
      renderScreen();

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      expect(api.GET).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("под итогами дня — вердикт о допуске тем же правилом, что в кабинете", async () => {
    // Соотношение в допуске — сказано словами; недобор калорий — набор, а не
    // тревога (вопрос 9 медкоманде, `dayVerdict` кита).
    serveOverview({
      data: {
        patient_id: SESSION.patientId,
        date: "2026-10-05",
        prescription: {
          ratio: 4,
          kcal_per_day: 1200,
          protein_g: 20,
          carbs_limit_g: 10,
          meals_per_day: 4,
        },
        day: {
          totals: {
            kcal: 600,
            fat: 60,
            protein: 10,
            carbs: 5,
            fiber: 0,
            ratio: 4,
          },
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: false,
          },
          tolerance_gap: null,
          engine_version: "1.0.0",
        },
        seizures_today: { count: 0 },
        seizure_trend: { direction: "flat" },
        last_reading_on: null,
      },
    });
    renderScreen();

    expect(
      await screen.findByText("Кетосоотношение дня соответствует назначению."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Набрано 600 из 1 200 ккал/)).toBeInTheDocument();
  });

  it("день, посчитанный прежним ядром, объясняется своей причиной", async () => {
    serveOverview({
      data: {
        patient_id: SESSION.patientId,
        date: "2026-10-05",
        prescription: null,
        day: {
          totals: {
            kcal: 600,
            fat: 60,
            protein: 10,
            carbs: 5,
            fiber: 0,
            ratio: 4,
          },
          tolerance: null,
          tolerance_gap: "engine_changed",
          engine_version: "0.4.0",
        },
        seizures_today: { count: 0 },
        seizure_trend: { direction: "flat" },
        last_reading_on: null,
      },
    });
    renderScreen();

    expect(
      await screen.findByText(/прежней версией расчётного ядра/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/активного назначения нет/),
    ).not.toBeInTheDocument();
  });

  it("имя ребёнка видно и до ответа сервера", async () => {
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: SESSION.patientName }),
    ).toBeInTheDocument();
  });
});
