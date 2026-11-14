import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import { AiSettingsPanel } from "./AiSettingsPanel";
import type { AiSettings } from "./useAiSettings";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), PUT: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const SPEND = { today_usd: "0.75", month_usd: "12.5" };

function group(
  name: "technical" | "specialists" | "families",
  overrides: Partial<AiSettings["groups"][number]> = {},
): AiSettings["groups"][number] {
  const families = name === "families";
  return {
    group: name,
    kinds: families
      ? ["assistant", "parse_meal", "parse_event"]
      : name === "technical"
        ? ["content_draft", "recipe_import"]
        : ["doctor_summary"],
    per_person_kinds: families
      ? ["assistant"]
      : name === "technical"
        ? ["content_draft"]
        : ["doctor_summary"],
    has_fast: families,
    enabled: true,
    model: null,
    model_fast: null,
    daily_budget_usd: null,
    monthly_budget_usd: null,
    user_daily_limit: null,
    defaults: {
      model: "claude-opus-5",
      model_fast: families ? "claude-haiku-4-5" : null,
      user_daily_limit: 30,
    },
    spend: SPEND,
    ...overrides,
  };
}

const SETTINGS: AiSettings = {
  key: {
    configured: true,
    source: "admin",
    hint: "…7788",
    unreadable: false,
    updated_at: "2026-11-14T09:00:00Z",
    updated_by_name: "Админ Тестовый",
    encryption: "derived",
  },
  project: {
    daily_budget_usd: null,
    monthly_budget_usd: "150",
    default_daily_budget_usd: "10",
    spend: SPEND,
  },
  groups: [
    group("technical", { enabled: false, daily_budget_usd: "3" }),
    group("specialists"),
    group("families"),
  ],
  models: [
    { id: "claude-opus-5", usd_per_mtok_in: "5", usd_per_mtok_out: "25" },
    { id: "claude-haiku-4-5", usd_per_mtok_in: "1", usd_per_mtok_out: "5" },
  ],
  applies_within_s: 30,
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<AiSettingsPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({ data: SETTINGS });
});

describe("раздел «Модели и расход»", () => {
  it("показывает ключ последними знаками, а не целиком", async () => {
    renderPanel();

    expect(
      await screen.findByText("Введён в кабинете, оканчивается на …7788"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Админ Тестовый/)).toBeInTheDocument();
  });

  it("показывает расход групп рядом с их бюджетом", async () => {
    renderPanel();

    const row = (await screen.findByText("Технические работы")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Выключена")).toBeInTheDocument();
    expect(within(row).getByText("$0,75 из $3,00")).toBeInTheDocument();
    // Модель не выбрана в кабинете — видно, какая работает и откуда.
    expect(within(row).getByText("claude-opus-5")).toBeInTheDocument();
    expect(within(row).getByText("задана при установке")).toBeInTheDocument();

    const families = screen.getByText("Семьи").closest("tr") as HTMLElement;
    expect(
      within(families).getByText("быстрая: claude-haiku-4-5"),
    ).toBeInTheDocument();
  });

  it("сохраняет группу: пустое поле — «по умолчанию», а не ноль", async () => {
    const user = userEvent.setup();
    (api.PUT as Mock).mockResolvedValue({ data: SETTINGS });
    renderPanel();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить группу «Специалисты»",
      }),
    );
    await user.type(
      await screen.findByLabelText(/Дневной бюджет группы/),
      "2,5",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect(api.PUT).toHaveBeenCalledWith("/api/v1/admin/ai/groups/{group}", {
      params: { path: { group: "specialists" } },
      body: {
        enabled: true,
        model: null,
        model_fast: null,
        daily_budget_usd: "2.5",
        monthly_budget_usd: null,
        user_daily_limit: null,
      },
    });
  });

  it("не отправляет нулевой бюджет", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить группу «Семьи»",
      }),
    );
    await user.type(
      await screen.findByLabelText(/Месячный бюджет группы/),
      "0",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      (await screen.findAllByText(adminRu.ai.errors.budget)).length,
    ).toBeGreaterThan(0);
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("проверка ключа говорит, что не так", async () => {
    const user = userEvent.setup();
    (api.POST as Mock).mockResolvedValue({
      data: { ok: false, problem: "unauthorized", models: [] },
    });
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "Проверить ключ" }),
    );

    expect(
      await screen.findByText(adminRu.ai.key.problem.unauthorized),
    ).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith("/api/v1/admin/ai/key/check", {
      body: { api_key: null },
    });
  });
});
