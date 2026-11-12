import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { SectionRouter } from "../../test/SectionRouter";
import { nativeSelect } from "../../test/nativeSelect";
import { RemainingPicks } from "./RemainingPicks";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

i18n.addResourceBundle("ru", "menu", menuRu, true, true);

describe("подбор блюда на остаток калорий", () => {
  it("показывает то, что укладывается в остаток, ближайшее к нему первым", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/custom-dishes")
          ? {
              data: {
                items: [
                  {
                    id: "d1",
                    title: "Омлет",
                    computed: { kcal: 280, ratio: 3.9 },
                  },
                  {
                    id: "d2",
                    title: "Большой обед",
                    computed: { kcal: 650, ratio: 4 },
                  },
                ],
                total: 2,
              },
            }
          : {
              data: {
                items: [
                  {
                    id: "r1",
                    title: "Кето-блинчики",
                    per_portion: { kcal: 390, ratio: 4.1 },
                  },
                ],
                total: 1,
              },
            },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <RemainingPicks patientId="p1" date="2026-11-12" remainingKcal={400} />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <SectionRouter section="menu">{children}</SectionRouter>
          </QueryClientProvider>
        ),
      },
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: /Подобрать блюдо на 400 ккал/,
      }),
    );

    const list = await screen.findByRole("list");
    const titles = within(list)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(titles[0]).toContain("Кето-блинчики");
    expect(titles[1]).toContain("Омлет");
    expect(titles.join()).not.toContain("Большой обед");
  });
});

describe("подобранное — сразу в приём", () => {
  it("«В приём…» ставит блюдо в этот день, без второго поиска", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/custom-dishes")
          ? {
              data: {
                items: [
                  {
                    id: "d1",
                    title: "Омлет",
                    computed: { kcal: 280, ratio: 3.9 },
                  },
                ],
                total: 1,
              },
            }
          : path.endsWith("/menus")
            ? {
                data: undefined,
                error: { error: { code: "not_found", message: "Меню нет." } },
              }
            : path.endsWith("/overview")
              ? { data: { prescription: { meals_per_day: 4 } } }
              : { data: { items: [], total: 0 } },
      ),
    );
    (api.PUT as Mock).mockResolvedValue({
      data: { date: "2026-11-12", items: [] },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <RemainingPicks patientId="p1" date="2026-11-12" remainingKcal={400} />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <SectionRouter section="menu">{children}</SectionRouter>
          </QueryClientProvider>
        ),
      },
    );
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: /Подобрать блюдо на 400 ккал/,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Добавить «Омлет» в приём" }),
    );
    // День задан итогами, спрашивается только приём.
    expect(screen.queryByLabelText("День")).not.toBeInTheDocument();
    await user.selectOptions(
      nativeSelect(await screen.findByLabelText("Приём")),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Добавить в меню" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect((api.PUT as Mock).mock.calls[0]![1].body).toEqual({
      date: "2026-11-12",
      items: [
        {
          meal_index: 2,
          recipe_id: null,
          custom_dish_id: "d1",
          portion_factor: 1,
        },
      ],
    });
  });
});
