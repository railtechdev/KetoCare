import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import { nativeSelect } from "../../test/nativeSelect";
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

type Group = AiSettings["groups"][number];
type Task = Group["tasks"][number];

function task(kind: Task["kind"], overrides: Partial<Task> = {}): Task {
  return {
    kind,
    per_person: kind === "assistant" || kind === "doctor_summary",
    model: null,
    effective_model: kind.startsWith("parse_")
      ? "claude-haiku-4-5"
      : "claude-opus-5",
    source: "env",
    usable: true,
    ...overrides,
  };
}

function group(name: Group["group"], overrides: Partial<Group> = {}): Group {
  const tasks: Task[] =
    name === "families"
      ? [task("assistant"), task("parse_meal"), task("parse_event")]
      : name === "technical"
        ? [task("content_draft"), task("recipe_import")]
        : [task("doctor_summary")];
  return {
    group: name,
    kinds: tasks.map((item) => item.kind),
    per_person_kinds: tasks
      .filter((item) => item.per_person)
      .map((item) => item.kind),
    enabled: true,
    model: null,
    tasks,
    daily_budget_usd: null,
    monthly_budget_usd: null,
    user_daily_limit: null,
    user_daily_budget_usd: null,
    default_user_daily_limit: 30,
    spend: SPEND,
    ...overrides,
  };
}

function model(
  ref: string,
  overrides: Partial<AiSettings["models"][number]> = {},
): AiSettings["models"][number] {
  return {
    ref,
    provider: "anthropic",
    model: ref,
    name: null,
    usd_per_mtok_in: "5",
    usd_per_mtok_out: "25",
    enabled: true,
    builtin: true,
    overridden: false,
    usable: true,
    in_use: false,
    ...overrides,
  };
}

const KEY_STATE = {
  configured: true,
  source: "admin" as const,
  hint: "…7788",
  unreadable: false,
  updated_at: "2026-11-14T09:00:00Z",
  updated_by_name: "Админ Тестовый",
};

const SETTINGS: AiSettings = {
  providers: [
    {
      id: "anthropic",
      kind: "anthropic",
      name: "Anthropic",
      base_url: null,
      enabled: true,
      builtin: true,
      ready: true,
      host_allowed: true,
      key: KEY_STATE,
      models_count: 2,
    },
    {
      id: "openai",
      kind: "openai",
      name: "OpenAI",
      base_url: null,
      enabled: true,
      builtin: false,
      ready: false,
      host_allowed: true,
      key: {
        configured: false,
        source: null,
        hint: null,
        unreadable: false,
        updated_at: null,
        updated_by_name: null,
      },
      models_count: 1,
    },
  ],
  provider_kinds: [
    {
      kind: "anthropic",
      needs_key: true,
      needs_base_url: false,
      default_base_url: "https://api.anthropic.com",
    },
    {
      kind: "openai",
      needs_key: true,
      needs_base_url: false,
      default_base_url: "https://api.openai.com/v1",
    },
    {
      kind: "ollama",
      needs_key: false,
      needs_base_url: true,
      default_base_url: null,
    },
  ],
  models: [
    model("claude-opus-5"),
    model("claude-haiku-4-5", { usd_per_mtok_in: "1", usd_per_mtok_out: "5" }),
    model("openai/gpt-x", {
      provider: "openai",
      model: "gpt-x",
      name: "GPT X",
      usd_per_mtok_in: "2.5",
      usd_per_mtok_out: "10",
      builtin: false,
      usable: false,
    }),
  ],
  project: {
    daily_budget_usd: null,
    monthly_budget_usd: "150",
    default_daily_budget_usd: "10",
    warn_percent: null,
    default_warn_percent: 80,
    spend: SPEND,
  },
  groups: [
    group("technical", { enabled: false, daily_budget_usd: "3" }),
    group("specialists"),
    group("families"),
  ],
  alerts: [],
  encryption: "derived",
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
  it("показывает ключ подключения последними знаками, а не целиком", async () => {
    renderPanel();

    expect(
      await screen.findByText("Введён в кабинете, оканчивается на …7788"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Админ Тестовый/)).toBeInTheDocument();
  });

  it("называет подключение без ключа неготовым, а его модель — невызываемой", async () => {
    renderPanel();

    const openai = (await screen.findAllByText("OpenAI"))[0]!.closest(
      "tr",
    ) as HTMLElement;
    expect(within(openai).getByText("Не готово")).toBeInTheDocument();
    const gpt = screen.getByText("GPT X").closest("tr") as HTMLElement;
    expect(within(gpt).getByText("Подключение не готово")).toBeInTheDocument();
    expect(within(gpt).getByText("$2,50 / $10,00")).toBeInTheDocument();
  });

  it("показывает расход групп рядом с бюджетом и модель каждой задачи", async () => {
    renderPanel();

    const row = (await screen.findByText("Технические работы")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Выключена")).toBeInTheDocument();
    expect(within(row).getByText("$0,75 из $3,00")).toBeInTheDocument();
    // Модель не выбрана в кабинете — видно, какая работает и откуда.
    expect(within(row).getAllByText(/claude-opus-5/)).toHaveLength(2);
    expect(within(row).getAllByText("(задана при установке)")).toHaveLength(2);

    const families = screen.getByText("Семьи").closest("tr") as HTMLElement;
    expect(within(families).getAllByText(/claude-haiku-4-5/)).toHaveLength(2);
  });

  it("сохраняет группу: своя модель у задачи, невызываемые не предлагаются", async () => {
    const user = userEvent.setup();
    (api.PUT as Mock).mockResolvedValue({ data: SETTINGS });
    renderPanel();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить группу «Технические работы»",
      }),
    );
    const groupModel = nativeSelect(
      await screen.findByLabelText(/Модель группы/),
    );
    // Подключение OpenAI без ключа: его модель сервер не примет, и форма её
    // не предлагает — выбор не должен заканчиваться отказом.
    expect(
      Array.from(groupModel.options).map((option) => option.value),
    ).not.toContain("openai/gpt-x");
    await user.selectOptions(groupModel, "claude-opus-5");
    await user.selectOptions(
      nativeSelect(
        screen.getByLabelText(/Модель задачи «чтение файла рецептов»/),
      ),
      "claude-haiku-4-5",
    );
    await user.type(screen.getByLabelText(/Денег на человека в сутки/), "2,5");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect(api.PUT).toHaveBeenCalledWith("/api/v1/admin/ai/groups/{group}", {
      params: { path: { group: "technical" } },
      body: {
        enabled: false,
        model: "claude-opus-5",
        // Пустой выбор у задачи — «как у группы»: в запрос он не идёт.
        task_models: { recipe_import: "claude-haiku-4-5" },
        daily_budget_usd: "3",
        monthly_budget_usd: null,
        user_daily_limit: null,
        user_daily_budget_usd: "2.5",
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

  it("проверка подключения говорит, что не так", async () => {
    const user = userEvent.setup();
    (api.POST as Mock).mockResolvedValue({
      data: { ok: false, problem: "unauthorized", models: [], in_catalog: [] },
    });
    renderPanel();

    await user.click(
      await screen.findByRole("button", {
        name: "Проверить подключение «Anthropic»",
      }),
    );

    expect(
      await screen.findByText(adminRu.ai.key.problem.unauthorized),
    ).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/admin/ai/providers/{provider_id}/check",
      {
        params: { path: { provider_id: "anthropic" } },
        body: { api_key: null },
      },
    );
  });

  it("добавляет подключение другого поставщика и сразу вводит его ключ", async () => {
    const user = userEvent.setup();
    const created: AiSettings = {
      ...SETTINGS,
      providers: [
        ...SETTINGS.providers,
        { ...SETTINGS.providers[1]!, id: "openai-2", name: "Второй ключ" },
      ],
    };
    (api.POST as Mock).mockResolvedValue({ data: created });
    (api.PUT as Mock).mockResolvedValue({ data: created });
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "Добавить подключение" }),
    );
    await user.type(await screen.findByLabelText(/Название/), "Второй ключ");
    await user.type(
      screen.getByLabelText(/^Ключ/, { selector: "input" }),
      "sk-second-0042",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect(api.POST).toHaveBeenCalledWith("/api/v1/admin/ai/providers", {
      body: {
        kind: "openai",
        name: "Второй ключ",
        base_url: null,
        enabled: true,
      },
    });
    // Ключ уходит в подключение, которое только что завёл сервер.
    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/admin/ai/providers/{provider_id}/key",
      {
        params: { path: { provider_id: "openai-2" } },
        body: { api_key: "sk-second-0042" },
      },
    );
  });

  it("у своей установки требует адрес", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "Добавить подключение" }),
    );
    await user.selectOptions(
      nativeSelect(await screen.findByLabelText(/Поставщик/)),
      "ollama",
    );
    await user.type(screen.getByLabelText(/Название/), "Локальная");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      (await screen.findAllByText(adminRu.ai.errors.baseUrl)).length,
    ).toBeGreaterThan(0);
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("добавляет модель в каталог и подставляет известную цену", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path === "/api/v1/admin/ai/models/price"
        ? {
            data: {
              known: true,
              usd_per_mtok_in: "2.5",
              usd_per_mtok_out: "10",
            },
          }
        : { data: SETTINGS },
    );
    (api.PUT as Mock).mockResolvedValue({ data: SETTINGS });
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "Добавить модель" }),
    );
    await user.selectOptions(
      nativeSelect(await screen.findByLabelText(/^Подключение/)),
      "openai",
    );
    await user.type(screen.getByLabelText(/Идентификатор модели/), "gpt-y");
    await user.tab();

    // Подсказка — известная публичная цена; считать будут по сохранённой.
    await waitFor(() =>
      expect(screen.getByLabelText(/Цена входа/)).toHaveValue("2.5"),
    );
    expect(
      screen.getByText(adminRu.ai.modelForm.suggested),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    expect(api.PUT).toHaveBeenCalledWith("/api/v1/admin/ai/models", {
      body: {
        provider: "openai",
        model: "gpt-y",
        name: null,
        usd_per_mtok_in: "2.5",
        usd_per_mtok_out: "10",
        enabled: true,
      },
    });
  });
});
