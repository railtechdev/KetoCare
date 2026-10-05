import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import { ChildSwitcher } from "./ChildSwitcher";
import { SessionGate } from "./SessionGate";

/**
 * Несколько детей в одном Telegram (ADR-0048): переключатель появляется только
 * при двух и больше, а выбор открывает новую сессию, суженную до выбранного.
 */

const launchData = vi.hoisted(() => vi.fn<() => string | null>());
const post = vi.hoisted(() => vi.fn());

vi.mock("../../lib/telegram", () => ({
  launchData,
  webApp: () => null,
  launchDiagnosis: () => ({ telegram: true, launchParams: true }),
}));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: post } };
});

const ANYA = "11111111-1111-4111-8111-111111111111";
const TIMUR = "22222222-2222-4222-8222-222222222222";
const CHILDREN = [
  { patient_id: ANYA, name: "Аня Иванова" },
  { patient_id: TIMUR, name: "Тимур Иванов" },
];

function opened(patientId: string, children = CHILDREN) {
  const child = children.find((c) => c.patient_id === patientId);
  return {
    data: {
      access_token: `a-${patientId}`,
      refresh_token: `r-${patientId}`,
      patient_id: patientId,
      patient_name: child?.name ?? "",
      children,
      web_url: "https://app.example",
      has_web_credentials: false,
    },
    response: { status: 200 },
  };
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <SessionGate>
      {(session, { switchChild }) => (
        <>
          <ChildSwitcher session={session} onSwitch={switchChild} />
          <p>Открыт {session.patientName}</p>
        </>
      )}
    </SessionGate>,
    { wrapper: Wrapper },
  );
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("несколько детей в одном Telegram", () => {
  it("у одного ребёнка переключателя нет", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue(opened(ANYA, [CHILDREN[0]!]));

    renderApp();

    expect(await screen.findByText("Открыт Аня Иванова")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ребёнок")).not.toBeInTheDocument();
  });

  it("у двух — переключатель с выбранным ребёнком", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue(opened(ANYA));

    renderApp();

    const select = await screen.findByLabelText("Ребёнок");
    expect(select).toHaveValue(ANYA);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Аня Иванова",
      "Тимур Иванов",
    ]);
  });

  it("выбор открывает новую сессию другого ребёнка", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/auth/miniapp/switch" ? opened(TIMUR) : opened(ANYA),
      ),
    );
    renderApp();
    const select = await screen.findByLabelText("Ребёнок");

    await userEvent.selectOptions(select, TIMUR);

    expect(await screen.findByText("Открыт Тимур Иванов")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/v1/auth/miniapp/switch", {
      body: { patient_id: TIMUR },
    });
    expect(screen.getByLabelText("Ребёнок")).toHaveValue(TIMUR);
  });

  it("при следующем запуске открывает выбранного в прошлый раз", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    localStorage.setItem("ketocare.miniapp.child", TIMUR);
    post.mockResolvedValue(opened(TIMUR));

    renderApp();

    expect(await screen.findByText("Открыт Тимур Иванов")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/v1/auth/telegram-init", {
      body: { init_data: "user=...&hash=...", patient_id: TIMUR },
    });
  });

  it("запомненного ребёнка отвязали — открывается первый, а не «не привязан»", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    localStorage.setItem("ketocare.miniapp.child", TIMUR);
    post
      .mockResolvedValueOnce({
        error: {
          error: {
            code: "not_found",
            message: "…",
            details: { reason: "child_not_linked" },
          },
        },
        response: { status: 404 },
      })
      .mockResolvedValueOnce(opened(ANYA, [CHILDREN[0]!]));

    renderApp();

    expect(await screen.findByText("Открыт Аня Иванова")).toBeInTheDocument();
    await waitFor(() => {
      expect(post).toHaveBeenLastCalledWith("/api/v1/auth/telegram-init", {
        body: { init_data: "user=...&hash=...", patient_id: null },
      });
    });
  });
});
