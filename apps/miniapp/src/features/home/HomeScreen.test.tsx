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

  it("имя ребёнка видно и до ответа сервера", async () => {
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: SESSION.patientName }),
    ).toBeInTheDocument();
  });
});
