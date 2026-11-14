import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import calculatorRu from "../../locales/ru/calculator.json";
import commonRu from "../../locales/ru/common.json";
import recipesRu from "../../locales/ru/recipes.json";
import { RecipeImportWorkbench } from "./RecipeImportWorkbench";
import type { ImportDraft } from "./useRecipeImportDraft";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      GET: vi.fn(),
      POST: vi.fn(),
      PUT: vi.fn(),
      PATCH: vi.fn(),
      DELETE: vi.fn(),
    },
  };
});

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);
i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const DRAFT_ID = "7f1c2d3e-0000-4000-8000-000000000001";
const NUT_ID = "7f1c2d3e-0000-4000-8000-0000000000aa";

/** Файл диетолога после чтения: одно название ждёт решения. */
const WAITING: ImportDraft = {
  id: DRAFT_ID,
  file_name: "Рецепты.docx",
  status: "ready",
  created_at: "2026-11-14T10:00:00Z",
  lines_total: 41,
  lines_done: 41,
  recipes: 1,
  imported: 0,
  failure: null,
  stalled: false,
  notes: [],
  ready: 0,
  names: [
    {
      key: "орехи макадамия (обжаренные)",
      name: "Орехи макадамия (обжаренные)",
      hint: null,
      recipes: 1,
      state: "unresolved",
      left_out: false,
      unweighed: 0,
      source: null,
      product: null,
      candidates: [
        { id: NUT_ID, name_ru: "Макадамия", counts_in_calculation: true },
      ],
    },
  ],
  items: [
    {
      id: "r1",
      title: "Кето-блинчики",
      category: "breakfast",
      servings: 1,
      yield_g: null,
      instructions: "Смешать и обжарить.",
      state: "needs_work",
      problems: ["lines"],
      recipe_id: null,
      signature: "sig-waiting",
      kcal: null,
      ratio: null,
      lines: [
        {
          index: 0,
          source: "Орехи макадамия (обжаренные) — 30 г",
          name: "Орехи макадамия (обжаренные)",
          key: "орехи макадамия (обжаренные)",
          grams: 30,
          state: "no_product",
          left_out: false,
          product_name: null,
        },
      ],
    },
  ],
};

const READY: ImportDraft = {
  ...WAITING,
  ready: 1,
  names: [
    {
      ...WAITING.names[0]!,
      state: "matched",
      source: "manual",
      product: {
        id: NUT_ID,
        name_ru: "Макадамия",
        counts_in_calculation: true,
      },
      candidates: [],
    },
  ],
  items: [
    {
      ...WAITING.items[0]!,
      state: "ready",
      problems: [],
      signature: "sig-ready",
      kcal: 215.4,
      ratio: 3.5,
      lines: [
        {
          ...WAITING.items[0]!.lines[0]!,
          state: "ok",
          product_name: "Макадамия",
        },
      ],
    },
  ],
};

function renderWorkbench(
  draftId: string | null,
  handlers: Partial<{
    onOpenDraft: (draftId: string | null) => void;
    onTemplate: () => void;
  }> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <RecipeImportWorkbench
      draftId={draftId}
      onOpenDraft={handlers.onOpenDraft ?? (() => {})}
      onOpenRecipe={() => {}}
      onTemplate={handlers.onTemplate ?? (() => {})}
      onDone={() => {}}
    />,
    { wrapper: Wrapper },
  );
}

function answerDraft(draft: ImportDraft) {
  (api.GET as Mock).mockImplementation((path: string) =>
    Promise.resolve(
      path === "/api/v1/recipe-imports"
        ? { data: [], error: undefined }
        : { data: draft, error: undefined },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("загрузка рецептов из файла", () => {
  it("вставленный текст уходит на разбор и открывает проверку", async () => {
    (api.GET as Mock).mockResolvedValue({ data: [], error: undefined });
    (api.POST as Mock).mockResolvedValue({
      data: { ...WAITING, status: "parsing" },
      error: undefined,
    });
    const onOpenDraft = vi.fn();
    const user = userEvent.setup();
    renderWorkbench(null, { onOpenDraft });

    await user.type(
      screen.getByLabelText("Или вставьте текст"),
      "Омлет: яйцо 55 г",
    );
    await user.click(screen.getByRole("button", { name: "Разобрать" }));

    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledWith(DRAFT_ID));
    const [path, options] = (api.POST as Mock).mock.calls[0]!;
    expect(path).toBe("/api/v1/recipe-imports");
    const form = options.bodySerializer() as FormData;
    expect(form.get("text")).toBe("Омлет: яйцо 55 г");
  });

  it("без файла и текста кнопка называет причину", async () => {
    (api.GET as Mock).mockResolvedValue({ data: [], error: undefined });
    renderWorkbench(null);

    expect(screen.getByRole("button", { name: "Разобрать" })).toBeDisabled();
    expect(
      screen.getByText("Выберите файл или вставьте текст"),
    ).toBeInTheDocument();
  });

  it("отказ сервера показан его словами — в них выход", async () => {
    (api.GET as Mock).mockResolvedValue({ data: [], error: undefined });
    (api.POST as Mock).mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: "validation_error",
          message: "PDF пока не читается. Вставьте текст.",
        },
      },
    });
    const user = userEvent.setup();
    renderWorkbench(null);

    await user.type(screen.getByLabelText("Или вставьте текст"), "текст");
    await user.click(screen.getByRole("button", { name: "Разобрать" }));

    expect(
      await screen.findByText("PDF пока не читается. Вставьте текст."),
    ).toBeInTheDocument();
  });

  it("начатая загрузка стоит в списке — к ней можно вернуться", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          id: DRAFT_ID,
          file_name: "Рецепты.docx",
          status: "ready",
          created_at: "2026-11-14T10:00:00Z",
          lines_total: 41,
          lines_done: 41,
          recipes: 3,
          imported: 1,
        },
      ],
      error: undefined,
    });
    const onOpenDraft = vi.fn();
    const user = userEvent.setup();
    renderWorkbench(null, { onOpenDraft });

    expect(await screen.findByText("Рецепты.docx")).toBeInTheDocument();
    expect(screen.getByText("принято 1 из 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(onOpenDraft).toHaveBeenCalledWith(DRAFT_ID);
  });

  it("прежний импорт по шаблону остаётся запасным путём", async () => {
    (api.GET as Mock).mockResolvedValue({ data: [], error: undefined });
    const onTemplate = vi.fn();
    const user = userEvent.setup();
    renderWorkbench(null, { onTemplate });

    await user.click(
      screen.getByRole("button", {
        name: "Загрузить таблицу по шаблону, без разбора",
      }),
    );

    expect(onTemplate).toHaveBeenCalled();
  });
});

describe("проверка разобранного файла", () => {
  it("незнакомое название ждёт решения, рецепт без него не готов", async () => {
    answerDraft(WAITING);
    renderWorkbench(DRAFT_ID);

    expect(await screen.findByText("Нужно уточнить: 1")).toBeInTheDocument();
    expect(screen.getByText("в 1 рецепте")).toBeInTheDocument();
    expect(
      screen.getByText("Есть строки состава, которые нужно уточнить."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Принять готовые" }),
    ).toBeDisabled();
  });

  it("предложенный продукт выбирается одним щелчком", async () => {
    answerDraft(WAITING);
    (api.PUT as Mock).mockResolvedValue({ data: READY, error: undefined });
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    await user.click(await screen.findByRole("button", { name: "Макадамия" }));

    await waitFor(() =>
      expect(api.PUT).toHaveBeenCalledWith(
        "/api/v1/recipe-imports/{draft_id}/names",
        {
          params: { path: { draft_id: DRAFT_ID } },
          body: {
            key: "орехи макадамия (обжаренные)",
            product_id: NUT_ID,
            left_out: false,
          },
        },
      ),
    );
    // Ответ сервера и есть новое состояние: рецепт стал готов и посчитан.
    expect(
      await screen.findByText("Все продукты сопоставлены."),
    ).toBeInTheDocument();
    expect(screen.getByText("Готов")).toBeInTheDocument();
    expect(screen.getByText("Соотношение: 3.5 : 1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Принять готовые" }),
    ).toBeEnabled();
  });

  it("«не взвешивать» есть только у названия со строками без массы", async () => {
    answerDraft(WAITING);
    renderWorkbench(DRAFT_ID);

    await screen.findByText("Нужно уточнить: 1");
    // У макадамии масса написана: общим решением её не убрать.
    expect(
      screen.queryByRole("button", { name: "Не взвешивать" }),
    ).not.toBeInTheDocument();
  });

  it("«не взвешивать» уходит на сервер и не трогает выбранный продукт", async () => {
    const vanilla = {
      ...WAITING.names[0]!,
      key: "ванильный экстракт",
      name: "Ванильный экстракт",
      unweighed: 1,
      candidates: [],
    };
    answerDraft({ ...WAITING, names: [vanilla] });
    (api.PUT as Mock).mockResolvedValue({ data: WAITING, error: undefined });
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    await user.click(
      await screen.findByRole("button", { name: "Не взвешивать" }),
    );

    await waitFor(() =>
      expect((api.PUT as Mock).mock.calls[0]![1].body).toEqual({
        key: "ванильный экстракт",
        product_id: null,
        left_out: true,
      }),
    );
  });

  it("продукт выбирается и из состава рецепта", async () => {
    answerDraft(WAITING);
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    await user.click(await screen.findByRole("button", { name: "Состав" }));
    await user.click(screen.getByRole("button", { name: "Выбрать продукт" }));

    expect(
      screen.getByText(
        "Продукт для «Орехи макадамия (обжаренные)» — во всех рецептах файла",
      ),
    ).toBeInTheDocument();
  });

  it("в составе исходная строка файла стоит рядом с разобранным", async () => {
    answerDraft(READY);
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    await user.click(await screen.findByRole("button", { name: "Состав" }));

    const table = screen.getByRole("table", {
      name: "Состав рецепта «Кето-блинчики»",
    });
    expect(
      within(table).getByText("Орехи макадамия (обжаренные) — 30 г"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Макадамия")).toBeInTheDocument();
    expect(
      within(table).getByLabelText("Масса, г: Орехи макадамия (обжаренные)"),
    ).toHaveValue("30");
  });

  it("масса, вписанная проверяющим, уходит на сервер", async () => {
    answerDraft(READY);
    (api.PATCH as Mock).mockResolvedValue({ data: READY, error: undefined });
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    await user.click(await screen.findByRole("button", { name: "Состав" }));
    const grams = screen.getByLabelText(
      "Масса, г: Орехи макадамия (обжаренные)",
    );
    await user.clear(grams);
    await user.type(grams, "28,5");
    await user.tab();

    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/recipe-imports/{draft_id}/recipes/{recipe_id}",
        {
          params: { path: { draft_id: DRAFT_ID, recipe_id: "r1" } },
          body: { lines: [{ index: 0, grams: 28.5 }] },
        },
      ),
    );
  });

  it("«принять готовые» загружает и помечает рецепт загруженным", async () => {
    answerDraft(READY);
    (api.POST as Mock).mockResolvedValue({
      data: {
        imported: 1,
        draft: {
          ...READY,
          ready: 0,
          imported: 1,
          items: [
            {
              ...READY.items[0]!,
              state: "imported",
              recipe_id: "7f1c2d3e-0000-4000-8000-0000000000bb",
            },
          ],
        },
      },
      error: undefined,
    });
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    await user.click(
      await screen.findByRole("button", { name: "Принять готовые" }),
    );

    expect(await screen.findByText("Загружен")).toBeInTheDocument();
    // Уходит то, что было на экране, с его подписью — не «всё готовое».
    expect((api.POST as Mock).mock.calls[0]![1].body).toEqual({
      recipes: [{ id: "r1", signature: "sig-ready" }],
    });
    expect(
      screen.getByRole("button", { name: "Открыть рецепт" }),
    ).toBeInTheDocument();
  });

  it("остановившееся чтение предлагает продолжить", async () => {
    answerDraft({
      ...WAITING,
      status: "failed",
      failure: "Дневной лимит ИИ-помощника исчерпан.",
      lines_done: 20,
    });
    (api.POST as Mock).mockResolvedValue({
      data: { ...WAITING, status: "parsing", lines_done: 20 },
      error: undefined,
    });
    const user = userEvent.setup();
    renderWorkbench(DRAFT_ID);

    expect(
      await screen.findByText("Дневной лимит ИИ-помощника исчерпан."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Продолжить чтение" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/recipe-imports/{draft_id}/resume",
        { params: { path: { draft_id: DRAFT_ID } } },
      ),
    );
  });
});
