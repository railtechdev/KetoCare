import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import commonRu from "../../locales/ru/common.json";
import recipesRu from "../../locales/ru/recipes.json";
import { RecipeImportPanel } from "./RecipeImportPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<RecipeImportPanel onDone={() => {}} />, { wrapper: Wrapper });
}

function file() {
  return new File(["title,category\n"], "recipes.csv", { type: "text/csv" });
}

const PREVIEW = {
  total_rows: 4,
  imported: 2,
  dry_run: true,
  errors: [],
  recipes: [
    {
      line: 2,
      title: "Омлет прогонный",
      category: "breakfast",
      servings: 1,
      ingredients: 2,
      kcal: 290.4,
      ratio: 4.2,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("импорт рецептов", () => {
  it("превью показывает, что посчитало ядро", async () => {
    /* Это и есть проверка файла по существу: состав, давший 0,4 : 1 вместо
       ожидаемых 4 : 1, виден до записи. */
    (api.POST as Mock).mockResolvedValue({ data: PREVIEW });
    const user = userEvent.setup();
    renderPanel();

    await user.upload(screen.getByLabelText(recipesRu.import.file), file());
    await user.click(
      screen.getByRole("button", { name: recipesRu.import.check }),
    );

    expect(await screen.findByText("Омлет прогонный")).toBeInTheDocument();
    expect(screen.getByText("290")).toBeInTheDocument();
    expect(screen.getByText("4.2 : 1")).toBeInTheDocument();
  });

  it("сначала проверка, запись — вторым нажатием", async () => {
    /* Порядок жёсткий: первый запрос всегда `dry_run=true`. */
    (api.POST as Mock).mockResolvedValue({ data: PREVIEW });
    const user = userEvent.setup();
    renderPanel();

    await user.upload(screen.getByLabelText(recipesRu.import.file), file());
    await user.click(
      screen.getByRole("button", { name: recipesRu.import.check }),
    );
    await screen.findByText("Омлет прогонный");

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/recipes/import",
      expect.objectContaining({ params: { query: { dry_run: true } } }),
    );

    (api.POST as Mock).mockResolvedValue({
      data: { ...PREVIEW, dry_run: false, imported: 2 },
    });
    await user.click(
      screen.getByRole("button", { name: recipesRu.import.confirm }),
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenLastCalledWith(
        "/api/v1/recipes/import",
        expect.objectContaining({ params: { query: { dry_run: false } } }),
      );
    });
  });

  it("файл с ошибками не даёт нажать «Импортировать»", async () => {
    /* Импорт идёт одной транзакцией: частично заведённый сборник разбирать
       дороже, чем завести заново. */
    (api.POST as Mock).mockResolvedValue({
      data: {
        total_rows: 2,
        imported: 0,
        dry_run: true,
        recipes: [],
        errors: [
          {
            line: 2,
            column: "product_name",
            message: "Продукта нет в справочнике.",
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.upload(screen.getByLabelText(recipesRu.import.file), file());
    await user.click(
      screen.getByRole("button", { name: recipesRu.import.check }),
    );

    expect(
      await screen.findByText("Продукта нет в справочнике."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: recipesRu.import.confirm }),
    ).toBeDisabled();
  });
});
