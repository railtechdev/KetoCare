import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import recipesRu from "../../locales/ru/recipes.json";
import { SectionRouter } from "../../test/SectionRouter";
import { RecipeFormPanel } from "./RecipeFormPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const BUTTER = "22222222-2222-4222-8222-222222222222";

const RECIPE = {
  id: RECIPE_ID,
  title: "Каша на масле",
  category: "breakfast",
  photo_path: null,
  yield_g: 200,
  servings: 1,
  instructions: "Смешать",
  status: "draft",
  computed: null,
  per_portion: null,
  engine_version: null,
  author_id: null,
  ingredients: [{ product_id: BUTTER, grams: 30, position: 0 }],
  created_at: "2026-08-01T10:00:00Z",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="recipes">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <RecipeFormPanel
      recipeId={RECIPE_ID}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
    { wrapper: Wrapper },
  );
}

/**
 * Подпись строки состава в форме правки.
 *
 * Раньше форма подставляла один запасной текст всему, чего не было в словаре
 * имён, — а туда не попадает ни удалённый продукт, ни тот, чья карточка не
 * доехала. После того как запасным текстом стало «продукт удалён из
 * справочника», форма начала утверждать удаление при отказе связи: ровно тот
 * дефект, который убран из карточки рецепта. Подпись берётся у состояния.
 */
describe("форма рецепта: подпись строки состава", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("не дошедшее имя не выдаётся за удалённый продукт", async () => {
    // Заслонка формы стоит на `isLoading`, а он после отказа ложен (в v5 это
    // `isPending && isFetching`) — форма отрисуется, и сказать неправду ей
    // ничто не помешает.
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/products/{product_id}") {
        throw new Error("сеть недоступна");
      }
      return { data: RECIPE, response: { status: 200 } };
    });
    renderPanel();

    expect(
      (await screen.findAllByText(/название не загрузилось/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(/продукт удалён из справочника/)).toHaveLength(
      0,
    );
  });

  it("удалённый продукт так и называется — удалённым", async () => {
    // 404 — ответ справочника, и вот здесь слово «удалён» уместно.
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path === "/api/v1/products/{product_id}"
        ? {
            error: { error: { code: "not_found", message: "Не найден." } },
            response: { status: 404 },
          }
        : { data: RECIPE, response: { status: 200 } },
    );
    renderPanel();

    expect(
      (await screen.findAllByText(/продукт удалён из справочника/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(/название не загрузилось/)).toHaveLength(0);
  });

  it("подпись обновляется, когда имя пришло", async () => {
    // Имя хранилось в значениях формы, а `defaultValues` читаются один раз при
    // монтировании: подпись застывала на том, что было известно в тот миг, и
    // строка навсегда оставалась «загружаем название…» — даже когда имя давно
    // пришло. Теперь она собирается при отрисовке, по состоянию.
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path === "/api/v1/products/{product_id}"
        ? {
            data: { id: BUTTER, name_ru: "Масло сливочное", is_active: true },
            response: { status: 200 },
          }
        : { data: RECIPE, response: { status: 200 } },
    );
    renderPanel();

    expect(
      (await screen.findAllByText(/Масло сливочное/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(/загружаем название/)).toHaveLength(0);
  });

  it("отказ карточки продукта не превращается в поток запросов", async () => {
    // Заслонка формы стояла на `isLoading` — флаге, который дёргается на каждый
    // подъём запроса. Форма монтировалась и размонтировалась следом за ним, её
    // наблюдатель поднимал отказавший запрос снова: замер давал 558 запросов за
    // 300 мс. Это поведение в бою, а не в тесте: открытая на правку форма
    // рецепта била бы по серверу без остановки.
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/products/{product_id}") {
        throw new Error("сеть недоступна");
      }
      return { data: RECIPE, response: { status: 200 } };
    });
    renderPanel();

    await screen.findAllByText(/название не загрузилось/);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const requests = (api.GET as Mock).mock.calls.filter(
      (call) => call[0] === "/api/v1/products/{product_id}",
    ).length;
    expect(requests).toBeLessThanOrEqual(3);
  });
});
