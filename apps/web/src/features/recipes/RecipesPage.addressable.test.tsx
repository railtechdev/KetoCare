import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import recipesRu from "../../locales/ru/recipes.json";
import { SectionRouter } from "../../test/SectionRouter";
import { currentAddress } from "../../test/address";
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
  // `response` в подмене обязателен: настоящий клиент отдаёт его всегда, а
  // карточка продукта различает по нему 404 и сбой связи. Здесь у рецепта
  // пустой состав, но подмена без `response` — это форма, которой в бою не
  // бывает, и первый же добавленный ингредиент ронял бы тест на пустом месте.
  (api.GET as Mock).mockImplementation((path: string) =>
    path === "/api/v1/recipes/{recipe_id}"
      ? Promise.resolve({ data: RECIPE, response: { status: 200 } })
      : Promise.resolve({
          data: { items: [RECIPE], total: 1 },
          response: { status: 200 },
        }),
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

describe("строка поиска в адресе", () => {
  it("приходит из калькулятора и попадает в поле", async () => {
    // Калькулятор, не нашедший продукт, уводит сюда с тем же словом: «суп из
    // говядины» — это блюдо. Раньше поиск жил только в памяти вкладки, и слово
    // приходилось набирать заново.
    renderPage({ q: "омлет" });

    const field = await screen.findByLabelText(/Поиск|Название/i);
    expect(field).toHaveValue("омлет");
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/recipes",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ q: "омлет" }),
          }),
        }),
      ),
    );
  });
});

describe("отборы выдачи в адресе", () => {
  it("F5 возвращает категорию и границы соотношения", async () => {
    renderPage({ category: "breakfast", ratioMin: "3", ratioMax: "4.5" });

    expect(await screen.findByLabelText("Категория")).toHaveValue("breakfast");
    expect(screen.getByLabelText("Соотношение от")).toHaveValue(3);
    expect(screen.getByLabelText("Соотношение до")).toHaveValue(4.5);
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/recipes",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({
              category: "breakfast",
              ratio_min: 3,
              ratio_max: 4.5,
            }),
          }),
        }),
      ),
    );
  });

  it("выбранная категория уходит в адрес, сброс его чистит", async () => {
    const user = userEvent.setup();
    renderPage({});

    await user.selectOptions(
      await screen.findByLabelText("Категория"),
      "breakfast",
    );
    await waitFor(() => expect(currentAddress().category).toBe("breakfast"));

    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    await waitFor(() => expect(currentAddress().category).toBeUndefined());
  });

  it("незнакомая категория в адресе — любая", async () => {
    renderPage({ category: "dessert-of-the-day" });

    expect(await screen.findByLabelText("Категория")).toHaveValue("");
  });
});

describe("форма рецепта в адресе", () => {
  it("F5 посреди правки возвращает в форму того же рецепта", async () => {
    renderPage({ item: `edit:${RECIPE_ID}` });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Правка рецепта" }),
    ).toBeInTheDocument();
  });

  it("новый рецепт открывается адресом, отмена возвращает к списку", async () => {
    const user = userEvent.setup();
    renderPage({ item: "new" });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Новый рецепт" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(currentAddress().item).toBeUndefined());
  });
});
