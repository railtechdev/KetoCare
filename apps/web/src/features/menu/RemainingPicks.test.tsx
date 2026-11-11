import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import menuRu from "../../locales/ru/menu.json";
import { SectionRouter } from "../../test/SectionRouter";
import { RemainingPicks } from "./RemainingPicks";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
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
    render(<RemainingPicks patientId="p1" remainingKcal={400} />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <SectionRouter section="menu">{children}</SectionRouter>
        </QueryClientProvider>
      ),
    });

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
