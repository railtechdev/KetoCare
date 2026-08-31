import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { RecipesScreen } from "./RecipesScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const RECIPE = {
  id: "r1",
  title: "Омлет на сливках",
  category: "breakfast",
  photo_path: null,
  yield_g: 180,
  servings: 2,
  instructions: "Взбить.\nЖарить.",
  status: "published",
  computed: { kcal: 800, fat: 80, protein: 16, carbs: 4, fiber: 0, ratio: 4 },
  per_portion: { kcal: 400, fat: 40, protein: 8, carbs: 2, fiber: 0, ratio: 4 },
  engine_version: "1.0.0",
  author_id: "a1",
  ingredients: [],
  created_at: "2026-08-01T10:00:00Z",
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
  return render(<RecipesScreen />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) =>
    path.endsWith("{recipe_id}")
      ? Promise.resolve({ data: RECIPE })
      : Promise.resolve({ data: { items: [RECIPE], total: 1 } }),
  );
});

describe("рецепты в Mini App", () => {
  it("открывает карточку из списка", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );

    expect(await screen.findByText("Как готовить")).toBeInTheDocument();
  });

  it("показывает порцию, а не весь выход", async () => {
    // У плиты считают порцию; подмена одного другим — ошибка в разы.
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );

    expect(await screen.findByText("400 ккал")).toBeInTheDocument();
    expect(screen.queryByText("800 ккал")).not.toBeInTheDocument();
  });

  it("перечитывает рецепт при открытии карточки", async () => {
    // Список мог загрузиться час назад, а по рецепту готовят сейчас.
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );
    await screen.findByText("Как готовить");

    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/recipes/{recipe_id}",
      expect.objectContaining({
        params: expect.objectContaining({ path: { recipe_id: "r1" } }),
      }),
    );
  });

  it("пустая выдача — это «ничего не нашлось», а не ошибка", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderScreen();

    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();
  });
});
