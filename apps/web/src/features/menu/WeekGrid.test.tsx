import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { SectionRouter } from "../../test/SectionRouter";
import { weekStartOf } from "./dates";
import { WeekGrid } from "./WeekGrid";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

function week(start: string) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${start}T12:00:00`);
    date.setDate(date.getDate() + index);
    return date.toLocaleDateString("sv-SE");
  });
  return {
    start,
    days: days.map((date, index) => ({
      date,
      menu:
        index === 0
          ? {
              id: "m1",
              totals: { kcal: 1180, ratio: 3.5 },
              items: [
                {
                  id: "i1",
                  meal_index: 2,
                  title: "Омлет",
                  portion_factor: 1,
                  ingredients: [
                    { product_id: "p1", name_ru: "Яйцо", grams: 40 },
                  ],
                },
              ],
            }
          : null,
    })),
  };
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="menu">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<WeekGrid patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  (api.GET as Mock).mockImplementation(
    (path: string, options: { params: { query: { start: string } } }) =>
      Promise.resolve(
        path.endsWith("/week")
          ? { data: week(options.params.query.start) }
          : { data: { prescription: { meals_per_day: 3 } } },
      ),
  );
  (api.POST as Mock).mockResolvedValue({
    data: { copied: ["2026-11-09"], skipped: [] },
  });
});

describe("неделя ребёнка", () => {
  it("ставит блюдо в строку его приёма и показывает итоги дня", async () => {
    renderGrid();

    const cell = await screen.findByText("Омлет");
    expect(cell.closest("tr")).toHaveTextContent("Приём 2");
    expect(screen.getByText("1 180 ккал")).toBeInTheDocument();
  });

  it("запрашивает неделю с понедельника", async () => {
    renderGrid();

    await screen.findByText("Омлет");
    const [, options] = (api.GET as Mock).mock.calls.find(([path]) =>
      (path as string).endsWith("/week"),
    )!;
    const start = options.params.query.start as string;
    expect(start).toBe(weekStartOf(start));
    expect(new Date(`${start}T12:00:00`).getDay()).toBe(1);
  });

  it("повторяет прошлую неделю только после подтверждения", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByText("Омлет");

    await user.click(
      screen.getByRole("button", { name: "Повторить прошлую неделю" }),
    );
    expect(api.POST).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/menus/week/copy",
        expect.anything(),
      ),
    );
  });

  it("печатает граммы блюд", async () => {
    const user = userEvent.setup();
    renderGrid();
    await screen.findByText("Омлет");

    await user.click(screen.getByRole("button", { name: "Печать недели" }));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body).toHaveTextContent("Яйцо");
    expect(document.body).toHaveTextContent("40 г");
  });
});

describe("начало недели", () => {
  it("воскресенье относится к неделе, начатой в понедельник", () => {
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
  });
});
