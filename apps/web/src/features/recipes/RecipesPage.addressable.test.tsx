import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import recipesRu from "../../locales/ru/recipes.json";
import { SectionRouter } from "../../test/SectionRouter";
import { RecipesPage } from "./RecipesPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u1", role: "dietitian" } }),
}));

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);

const RECIPE_ID = "22222222-2222-4222-8222-222222222222";

const RECIPE = {
  id: RECIPE_ID,
  title: "Омлет на сливках",
  category: "breakfast",
  photo_path: null,
  yield_g: 180,
  servings: 1,
  instructions: "Взбить и пожарить.",
  status: "published",
  computed: { kcal: 400, fat: 40, protein: 8, carbs: 2, fiber: 0, ratio: 4 },
  per_portion: { kcal: 400, fat: 40, protein: 8, carbs: 2, fiber: 0, ratio: 4 },
  engine_version: "0.3.0",
  author_id: "a1",
  ingredients: [],
  created_at: "2026-08-01T10:00:00Z",
};

function renderPage(search: Record<string, string>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="recipes" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<RecipesPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) =>
    path === "/api/v1/recipes/{recipe_id}"
      ? Promise.resolve({ data: RECIPE })
      : Promise.resolve({ data: { items: [RECIPE], total: 1 } }),
  );
});

describe("карточка рецепта в адресе", () => {
  it("ссылка открывает рецепт, а не список", async () => {
    // По рецепту готовят и его обсуждают с диетологом: ссылку надо уметь
    // переслать, а F5 не должен возвращать к списку.
    renderPage({ item: RECIPE_ID });

    expect(await screen.findByText("Взбить и пожарить.")).toBeInTheDocument();
  });

  it("без параметра показывает список", async () => {
    renderPage({});

    expect(await screen.findByText("Омлет на сливках")).toBeInTheDocument();
    expect(screen.queryByText("Взбить и пожарить.")).not.toBeInTheDocument();
  });
});
