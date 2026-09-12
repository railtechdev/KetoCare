import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import recipesRu from "../../locales/ru/recipes.json";
import { SectionRouter } from "../../test/SectionRouter";
import { RecipeDetail } from "./RecipeDetail";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const BUTTER = "22222222-2222-4222-8222-222222222222";
const FLAX = "33333333-3333-4333-8333-333333333333";

const RECIPE = {
  id: RECIPE_ID,
  title: "Каша на масле",
  category: "breakfast",
  photo_path: null,
  yield_g: 200,
  servings: 1,
  instructions: "Смешать",
  status: "published",
  computed: {
    kcal: 400,
    fat: 40,
    protein: 5,
    carbs: 5,
    fiber: 1,
    ratio: 4,
  },
  per_portion: null,
  engine_version: "1.0.0",
  author_id: null,
  ingredients: [
    { product_id: BUTTER, grams: 30, position: 0 },
    { product_id: FLAX, grams: 20, position: 1 },
  ],
  created_at: "2026-08-01T10:00:00Z",
};

function product(id: string, name: string, isActive: boolean) {
  return {
    id,
    name_ru: name,
    name_uz: null,
    name_en: null,
    category_id: null,
    kcal_100g: 700,
    fat_100g: 80,
    protein_100g: 1,
    carbs_100g: 1,
    fiber_100g: 0,
    source: "USDA",
    source_version: "SR Legacy",
    verified_at: "2026-01-01",
    is_active: isActive,
  };
}

function renderDetail(canEdit = false) {
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
    <RecipeDetail
      recipeId={RECIPE_ID}
      canEdit={canEdit}
      onBack={() => {}}
      onEdit={() => {}}
    />,
    { wrapper: Wrapper },
  );
}

describe("карточка рецепта", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `response` в подмене обязателен: настоящий клиент отдаёт его всегда, а
    // код различает 404 («такого продукта нет») и сбой связи именно по нему.
    // Мок без `response` — это форма, которой в бою не бывает; тест на ней
    // проходит, а продукт ломается.
    (api.GET as Mock).mockImplementation(
      async (_path: string, init: unknown) => {
        const options = init as {
          params?: { path?: { product_id?: string } };
        };
        const id = options?.params?.path?.product_id;
        if (id === BUTTER) {
          return {
            data: product(BUTTER, "Масло сливочное", true),
            response: { status: 200 },
          };
        }
        if (id === FLAX) {
          return {
            data: product(FLAX, "Масло льняное", false),
            response: { status: 200 },
          };
        }
        return { data: RECIPE, response: { status: 200 } };
      },
    );
  });

  it("у опубликованного рецепта предлагает снять с публикации", async () => {
    // Публикация была необратимой — при том что отказ удалить использованный
    // рецепт сам советовал «снимите его с публикации».
    renderDetail(true);

    expect(
      await screen.findByRole("button", { name: /Снять с публикации/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Опубликовать/ }),
    ).not.toBeInTheDocument();
  });

  it("называет выведенный из оборота продукт в составе", async () => {
    // Вывод продукта убирает его из поиска, но не из уже сохранённого рецепта —
    // рецепт, по которому кормили, не подменяется задним числом. Молчать
    // нельзя: показатели рецепта посчитаны в том числе по этому продукту, а
    // выводят его обычно потому, что числа оказались неверными.
    renderDetail();

    const banner = await screen.findByText(
      recipesRu.detail.withdrawnTitle as string,
    );
    expect(banner.parentElement).toHaveTextContent(/Масло льняное/);

    // Пометка стоит у той строки состава, к которой относится.
    const marks = screen.getAllByText(recipesRu.detail.withdrawn as string);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.parentElement).toHaveTextContent("Масло льняное");
  });

  it("удалённый продукт так и называется — удалённым", async () => {
    // 404 — это ответ справочника «такого продукта нет», а не сбой связи.
    // Смешать их значило бы обещать имя, которое никогда не придёт.
    (api.GET as Mock).mockImplementation(
      async (_path: string, init: unknown) => {
        const options = init as { params?: { path?: { product_id?: string } } };
        const id = options?.params?.path?.product_id;
        if (id === BUTTER) {
          return {
            data: product(BUTTER, "Масло сливочное", true),
            response: { status: 200 },
          };
        }
        if (id === FLAX) {
          return {
            error: { error: { code: "not_found", message: "Не найден." } },
            response: { status: 404 },
          };
        }
        return { data: RECIPE, response: { status: 200 } };
      },
    );
    renderDetail();

    expect(await screen.findByText("Масло сливочное")).toBeInTheDocument();
    expect(
      screen.getByText("продукт удалён из справочника"),
    ).toBeInTheDocument();
    expect(screen.getByText("30 г")).toBeInTheDocument();
    expect(screen.getByText("20 г")).toBeInTheDocument();
  });

  it("не дошедшее имя не выдаётся за удалённый продукт", async () => {
    // Отказ связи — утверждение о сети, а не о справочнике. Сказать здесь
    // «удалён» значит соврать о данных, по которым готовят.
    (api.GET as Mock).mockImplementation(
      async (_path: string, init: unknown) => {
        const options = init as { params?: { path?: { product_id?: string } } };
        const id = options?.params?.path?.product_id;
        if (id === BUTTER) {
          return {
            data: product(BUTTER, "Масло сливочное", true),
            response: { status: 200 },
          };
        }
        if (id === FLAX) throw new Error("сеть недоступна");
        return { data: RECIPE, response: { status: 200 } };
      },
    );
    renderDetail();

    expect(await screen.findByText("Масло сливочное")).toBeInTheDocument();
    expect(
      await screen.findByText("название не загрузилось"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("продукт удалён из справочника"),
    ).not.toBeInTheDocument();
  });

  it("граммовка видна, пока имена ещё в пути", async () => {
    // Состав, спрятанный целиком, — это карточка без рецепта, а по ней готовят.
    // Раньше на его месте стояли скелетоны, и вместе с именами исчезали граммы.
    (api.GET as Mock).mockImplementation(
      async (_path: string, init: unknown) => {
        const options = init as { params?: { path?: { product_id?: string } } };
        if (options?.params?.path?.product_id !== undefined) {
          return new Promise(() => {});
        }
        return { data: RECIPE, response: { status: 200 } };
      },
    );
    renderDetail();

    expect(await screen.findByText("30 г")).toBeInTheDocument();
    expect(screen.getByText("20 г")).toBeInTheDocument();
    expect(screen.getAllByText("загружаем название…")).toHaveLength(2);
  });
});
