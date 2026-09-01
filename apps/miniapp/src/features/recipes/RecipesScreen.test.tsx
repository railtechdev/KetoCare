import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
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

const showBackButton = vi.hoisted(() =>
  vi.fn<(onBack: () => void) => () => void>(() => () => undefined),
);
vi.mock("../../lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/telegram")>();
  return { ...actual, showBackButton };
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
  (api.GET as Mock).mockImplementation((path: string, options?: unknown) => {
    if (path.endsWith("{recipe_id}")) return Promise.resolve({ data: RECIPE });
    if (path.endsWith("{product_id}")) {
      const id = (options as { params: { path: { product_id: string } } })
        .params.path.product_id;
      return Promise.resolve({
        data: { id, name_ru: PRODUCT_NAMES[id] ?? "Продукт", is_active: true },
      });
    }
    return Promise.resolve({ data: { items: [RECIPE], total: 1 } });
  });
});

const PRODUCT_NAMES: Record<string, string> = {
  "prod-1": "Яйцо куриное",
  "prod-2": "Сливки 33%",
};

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

  it("карточка показывает состав с граммовкой и называет масштаб", async () => {
    // По карточке готовят: показатели порции без «из чего и сколько» —
    // инструкция без рецепта (находка М2 аудита). Рядом стоят показатели
    // ОДНОЙ порции, поэтому заголовок состава называет масштаб — весь выход.
    (api.GET as Mock).mockImplementation((path: string, options?: unknown) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          data: {
            ...RECIPE,
            ingredients: [
              { product_id: "prod-1", grams: 120, position: 0 },
              { product_id: "prod-2", grams: 60, position: 1 },
            ],
          },
        });
      if (path.endsWith("{product_id}")) {
        const id = (options as { params: { path: { product_id: string } } })
          .params.path.product_id;
        return Promise.resolve({
          data: {
            id,
            name_ru: PRODUCT_NAMES[id] ?? "Продукт",
            is_active: true,
          },
        });
      }
      return Promise.resolve({ data: { items: [RECIPE], total: 1 } });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );

    expect(
      await screen.findByText(/Состав — на весь выход \(2 порции\)/),
    ).toBeInTheDocument();
    expect(await screen.findByText("Яйцо куриное")).toBeInTheDocument();
    expect(screen.getByText("120 г")).toBeInTheDocument();
    expect(screen.getByText("Сливки 33%")).toBeInTheDocument();
  });

  it("карточка включает системную «Назад» Telegram и она ведёт к списку", async () => {
    // Аппаратная «Назад» на Android иначе закрывает весь Mini App: родитель
    // из карточки попадал в чат, а не к списку (находка М8 аудита).
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );
    await screen.findByText("Как готовить");

    expect(showBackButton).toHaveBeenCalledTimes(1);
    const [onBack] = showBackButton.mock.calls[0] as [() => void];
    act(() => {
      onBack();
    });

    expect(await screen.findByLabelText("Найдите рецепт")).toBeInTheDocument();
  });

  it("пустая выдача — это «ничего не нашлось», а не ошибка", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderScreen();

    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();
  });
});
