import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import childRu from "../../locales/ru/child.json";
import { ExcludedProductsField } from "./ExcludedProductsField";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "child", childRu, true, true);

const PEANUT = "3f2a0000-0000-4000-8000-000000000001";

function renderField() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <ExcludedProductsField value={[PEANUT]} onChange={() => {}} known={[]} />,
    { wrapper: Wrapper },
  );
}

describe("исключённые продукты", () => {
  it("группа подписана legend, а кнопка «убрать» — названием, не идентификатором", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/products/{product_id}"
          ? {
              data: {
                id: PEANUT,
                name_ru: "Арахис",
                kcal_100g: 567,
                fat_100g: 49,
                protein_100g: 26,
                carbs_100g: 16,
                fiber_100g: 8.5,
                is_active: true,
              },
            }
          : { data: { items: [], total: 0 } },
      ),
    );
    renderField();

    expect(
      screen.getByRole("group", { name: childRu.child.fields.excluded }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: "Убрать из исключений: Арахис",
      }),
    ).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("aria-label") ?? "").not.toContain(PEANUT);
    }
  });
});
