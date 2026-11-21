import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { SettingsScreen } from "./SettingsScreen";

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

function renderSettings(familyPhone: string | null) {
  (api.GET as Mock).mockImplementation(async (path: string) => {
    if (path === "/api/v1/letterhead") {
      return {
        data: { text: { family_phone: familyPhone } },
        response: { status: 200 },
      };
    }
    if (path.endsWith("/medications")) {
      return {
        data: {
          items: [
            {
              id: "m1",
              drug_name: "Вальпроат",
              dose: "250 мг",
              frequency_code: "twice_daily",
              frequency: null,
              started_at: "2026-01-01",
              stopped_at: null,
            },
          ],
          total: 1,
        },
        response: { status: 200 },
      };
    }
    // Близкие и коды — списки; напоминания — ошибкой: их блок здесь не важен.
    if (path.endsWith("/parents") || path.endsWith("/access-codes")) {
      return { data: [], response: { status: 200 } };
    }
    return {
      error: { error: { code: "not_found", message: "нет" } },
      response: { status: 404 },
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<SettingsScreen session={SESSION} onClose={vi.fn()} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Р4 аудита Mini App: схема препаратов и телефон клиники — и в настройках, у
 * семьи из Telegram их больше негде взять.
 */
describe("настройки: схема и телефон клиники", () => {
  it("схема открывается экраном и возвращает в настройки", async () => {
    const user = userEvent.setup();
    renderSettings(null);

    await user.click(
      await screen.findByRole("button", { name: "Открыть схему" }),
    );
    expect(await screen.findByText("Вальпроат")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Настройки" }));
    expect(
      await screen.findByRole("heading", { name: "Настройки", level: 1 }),
    ).toBeInTheDocument();
  });

  it("телефон клиники — ссылкой, если задан", async () => {
    renderSettings("+998 71 200-00-00");

    expect(
      await screen.findByRole("link", { name: "+998 71 200-00-00" }),
    ).toHaveAttribute("href", "tel:+998712000000");
  });

  it("телефона нет — блока нет", async () => {
    renderSettings(null);

    await screen.findByRole("button", { name: "Открыть схему" });
    expect(screen.queryByText("Связь с клиникой")).not.toBeInTheDocument();
  });
});
