import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import ru from "../../locales/ru/app.json";
import { AddToPlan } from "./AddToPlan";
import { dayAt } from "./useMenu";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

const PATIENT = "11111111-1111-4111-8111-111111111111";

type Query = { params?: { query?: { date?: string } } };

/** Назначение по дате: `undefined` — запрос отказал, `null` — назначения нет. */
function respond(prescriptionOn: (date: string) => unknown) {
  (api.GET as Mock).mockImplementation(async (path: string, init?: Query) => {
    if (path.endsWith("/prescriptions/on")) {
      const date = init?.params?.query?.date ?? "";
      const prescription = prescriptionOn(date);
      return prescription === undefined
        ? { error: { message: "Сбой" }, response: { status: 500 } }
        : {
            data: { date, prescription },
            response: { status: 200 },
          };
    }
    if (path.endsWith("/menus/week")) {
      return { data: { days: [] }, response: { status: 200 } };
    }
    return { response: { status: 404 } };
  });
}

function renderAdd() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <AddToPlan patientId={PATIENT} dish={{ kind: "recipe", id: "r1" }} />,
    { wrapper: Wrapper },
  );
}

const plan = ru.calculator.plan;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("«Добавить в меню»: полоса дней не пропадает", () => {
  it("отказ назначения дня — сказано, есть повтор, и можно вернуться к сегодня", async () => {
    respond((date) => (date === dayAt(2) ? undefined : { meals_per_day: 3 }));
    const user = userEvent.setup();
    renderAdd();

    expect(await screen.findByLabelText(plan.meal)).toBeInTheDocument();
    const strip = screen.getByRole("group", { name: plan.day });
    const days = strip.querySelectorAll("button");
    await user.click(days[2]!);

    expect(await screen.findByText(plan.prescriptionFailed)).toBeVisible();
    expect(
      screen.getByRole("button", { name: ru.actions.retry }),
    ).toBeVisible();
    // Полоса на месте: к «Сегодня» вернуться можно.
    await user.click(screen.getByRole("button", { name: /^Сегодня/ }));
    expect(await screen.findByLabelText(plan.meal)).toBeInTheDocument();
  });

  it("пока назначение дня грузится, полоса стоит", async () => {
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.endsWith("/prescriptions/on")
        ? new Promise(() => {})
        : { data: { days: [] }, response: { status: 200 } },
    );
    renderAdd();

    expect(await screen.findByText(plan.prescriptionUnknown)).toBeVisible();
    expect(screen.getByRole("group", { name: plan.day })).toBeVisible();
  });

  it("сегодня назначения нет — день, где оно начнётся, выбрать можно", async () => {
    respond((date) => (date === dayAt(0) ? null : { meals_per_day: 3 }));
    const user = userEvent.setup();
    renderAdd();

    expect(await screen.findByText(plan.noPrescription)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Завтра/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(plan.meal)).toBeInTheDocument(),
    );
  });
});
