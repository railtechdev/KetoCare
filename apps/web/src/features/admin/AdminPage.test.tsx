import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { SectionRouter } from "../../test/SectionRouter";
import { SessionProvider } from "../auth/session";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import { api } from "../../lib/api";
import { AdminPage } from "./AdminPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn() },
  };
});

// Пространство имён экрана подключает координатор (`lib/i18n.ts` — общий файл),
// поэтому тест регистрирует словарь сам: иначе проверялись бы ключи, а не текст.
i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const SELF_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** Токен разбирается только для claims: подпись клиент не проверяет. */
const ACCESS_TOKEN = `header.${btoa(
  JSON.stringify({ sub: SELF_ID, role: "admin" }),
)}.signature`;

const USERS = {
  items: [
    {
      id: SELF_ID,
      role: "admin",
      full_name: "Алексей Смирнов",
      email: "admin@example.org",
      phone: null,
      is_active: true,
      created_at: "2026-01-10T08:00:00Z",
    },
    {
      id: OTHER_ID,
      role: "parent",
      full_name: "Мария Иванова",
      email: "parent@example.org",
      phone: null,
      is_active: true,
      created_at: "2026-02-11T09:30:00Z",
    },
  ],
  total: 2,
};

const PRODUCT_ID = "2b1a0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d";

const PRODUCTS = {
  items: [
    {
      id: PRODUCT_ID,
      name_ru: "Масло сливочное",
      name_uz: null,
      name_en: null,
      category_id: "6f1e5c34-9b7a-4c2d-8f10-2a3b4c5d6e7f",
      kcal_100g: 717,
      fat_100g: 81.1,
      protein_100g: 0.85,
      carbs_100g: 0.06,
      fiber_100g: 0,
      source: "USDA",
      source_version: "SR Legacy 2018",
      verified_at: "2026-03-01",
      is_active: true,
    },
  ],
  total: 1,
};

const AUDIT_ENTRIES = {
  items: [
    {
      id: "3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
      user_id: SELF_ID,
      action: "update",
      entity: "products",
      entity_id: PRODUCT_ID,
      before: { fat_100g: 80 },
      after: { fat_100g: 81.1 },
      payload_hidden: false,
      ip: "10.0.0.4",
      created_at: "2026-08-20T10:15:00Z",
    },
    {
      id: "4b3c2d1e-0f9a-4b8c-9d7e-6f5a4b3c2d1e",
      user_id: OTHER_ID,
      action: "create",
      entity: "prescriptions",
      entity_id: "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f",
      before: null,
      after: null,
      payload_hidden: true,
      ip: null,
      created_at: "2026-08-21T11:00:00Z",
    },
  ],
  total: 2,
};

const DRY_RUN_REPORT = {
  total_rows: 4,
  imported: 0,
  updated: 0,
  updates: [],
  errors: [
    { line: 3, column: "fat_100g", message: "Ожидалось число." },
    { line: 3, column: "verified_at", message: "Ожидалась дата." },
  ],
  dry_run: true,
};

const IMPORT_REPORT = {
  total_rows: 4,
  imported: 3,
  updated: 0,
  updates: [],
  errors: [{ line: 5, column: "name_ru", message: "Продукт уже есть в базе." }],
  dry_run: false,
};

function renderPage(section: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          {/* Второй уровень раздела продуктов живёт в адресе (`?item=`,
              правило П1), поэтому экрану нужен роутер — как и в работающем
              приложении. */}
          <SectionRouter section={section}>{children}</SectionRouter>
          {/* Toaster монтируется в AppLayout, а тест рендерит экран отдельно:
              без него подтверждению успеха некуда показаться (правило П16). */}
          <Toaster />
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  return render(<AdminPage section={section} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();

  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/admin/users") return Promise.resolve({ data: USERS });
    if (path === "/api/v1/products") return Promise.resolve({ data: PRODUCTS });
    if (path === "/api/v1/admin/audit-log")
      return Promise.resolve({ data: AUDIT_ENTRIES });
    throw new Error(`Unexpected GET ${path}`);
  });

  (api.POST as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/auth/refresh")
      return Promise.resolve({ data: { access_token: ACCESS_TOKEN } });
    throw new Error(`Unexpected POST ${path}`);
  });
});

describe("AdminPage — учётные записи", () => {
  it("не предлагает править собственную учётную запись", async () => {
    renderPage("users");

    expect(await screen.findByText("Мария Иванова")).toBeInTheDocument();

    // Сервер запрещает и отключение себя, и смену своей роли: кнопки нет,
    // чтобы администратор не упирался в отказ.
    expect(screen.getByText("Свою запись изменить нельзя")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Изменить" })).toHaveLength(1);
  });

  it("отправляет роль и активность одним PATCH", async () => {
    const user = userEvent.setup();
    (api.PATCH as Mock).mockResolvedValue({
      data: { ...USERS.items[1], role: "doctor" },
    });

    renderPage("users");
    await user.click(await screen.findByRole("button", { name: "Изменить" }));

    // Поле роли есть и в форме правки, и в панели приглашения — ищем в нужной.
    const form = within(
      screen.getByRole("button", { name: "Сохранить" }).closest("form")!,
    );
    await user.selectOptions(form.getByLabelText("Роль"), "doctor");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/admin/users/{user_id}",
      expect.objectContaining({
        params: { path: { user_id: OTHER_ID } },
        body: { role: "doctor", is_active: true },
      }),
    );
  });
});

describe("AdminPage — импорт продуктов", () => {
  it("сначала показывает построчный отчёт, и только потом импортирует", async () => {
    const user = userEvent.setup();
    (api.POST as Mock).mockImplementation(
      (
        path: string,
        options: { params?: { query?: { dry_run?: boolean } } },
      ) => {
        if (path === "/api/v1/auth/refresh")
          return Promise.resolve({ data: { access_token: ACCESS_TOKEN } });
        if (path === "/api/v1/products/import") {
          return Promise.resolve({
            data: options.params?.query?.dry_run
              ? DRY_RUN_REPORT
              : IMPORT_REPORT,
          });
        }
        throw new Error(`Unexpected POST ${path}`);
      },
    );

    renderPage("products");
    await user.click(await screen.findByRole("button", { name: "Импорт CSV" }));

    const file = new File(["name_ru,category\n"], "products.csv", {
      type: "text/csv",
    });
    await user.upload(screen.getByLabelText("Файл CSV"), file);
    await user.click(screen.getByRole("button", { name: "Проверить файл" }));

    // Отчёт построчный: номер строки, колонка и причина — по нему исправляют файл.
    expect(await screen.findByText("Ожидалось число.")).toBeInTheDocument();
    expect(screen.getByText("Ожидалась дата.")).toBeInTheDocument();
    expect(screen.getByText(/Строк с ошибками: 1/)).toBeInTheDocument();

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/products/import",
      expect.objectContaining({
        params: { query: { dry_run: true, update_existing: false } },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Импортировать" }));

    // Успех — тостом, а не «вечным» баннером в потоке страницы (правило П16):
    // баннер оставался висеть и после перехода к следующему файлу.
    expect(
      await screen.findByText("Импортировано строк: 3"),
    ).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/products/import",
      expect.objectContaining({
        params: { query: { dry_run: false, update_existing: false } },
      }),
    );
  });
});

describe("AdminPage — журнал аудита", () => {
  it("показывает изменения свёрнутыми и не раскрывает клиническую нагрузку", async () => {
    renderPage("audit");

    expect(await screen.findByText("Записи 1–2 из 2")).toBeInTheDocument();

    // Правка продукта показывается целиком: клинических данных в ней нет.
    expect(screen.getByText("Было")).toBeInTheDocument();
    expect(screen.getByText("Стало")).toBeInTheDocument();

    // Назначение — клинические данные: сервер вырезает нагрузку, экран
    // объясняет, почему её нет, вместо пустой ячейки.
    expect(
      screen.getByText(
        "Скрыто: клинические данные администратору не показываются",
      ),
    ).toBeInTheDocument();
  });
});

describe("AdminPage — обновляющий импорт", () => {
  const UPDATE_PREVIEW = {
    total_rows: 1,
    imported: 0,
    updated: 1,
    updates: [
      {
        line: 2,
        product_id: "11111111-1111-4111-8111-111111111111",
        name_ru: "Масло сливочное",
        changes: [
          { field: "fat_100g", before: "81.1", after: "82.5" },
          { field: "source_version", before: "SR28", after: "SR Legacy 2024" },
        ],
      },
    ],
    errors: [],
    dry_run: true,
  };

  it("превью называет, что именно перезапишется", async () => {
    // «Обновлено 412 позиций» без перечня — отчёт, который нечем проверить,
    // а переписываются числа, по которым считают еду ребёнку.
    const user = userEvent.setup();
    (api.POST as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/auth/refresh")
        return Promise.resolve({ data: { access_token: ACCESS_TOKEN } });
      return Promise.resolve({ data: UPDATE_PREVIEW });
    });

    renderPage("products");
    await user.click(await screen.findByRole("button", { name: "Импорт CSV" }));

    const file = new File(["name_ru,category\n"], "products.csv", {
      type: "text/csv",
    });
    await user.upload(screen.getByLabelText("Файл CSV"), file);
    await user.click(
      screen.getByRole("checkbox", { name: /Обновить существующие/ }),
    );
    await user.click(screen.getByRole("button", { name: "Проверить файл" }));

    expect(await screen.findByText("Масло сливочное")).toBeInTheDocument();
    expect(screen.getByText(/81.1/)).toBeInTheDocument();
    expect(screen.getByText("82.5")).toBeInTheDocument();

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/products/import",
      expect.objectContaining({
        params: { query: { dry_run: true, update_existing: true } },
      }),
    );
  });
});

describe("AdminPage — навигация", () => {
  it("не повторяет боковое меню полосой вкладок", async () => {
    // Те же пять пунктов стояли и в меню, и вкладками на каждом экране: одна и
    // та же навигация, показанная дважды, занимала верх экрана и заставляла
    // выбирать, каким из двух способов ходить (правило П3 канона).
    renderPage("users");

    await screen.findByText("Мария Иванова");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("называет подраздел заголовком экрана, а не общим «Администрирование»", async () => {
    renderPage("audit");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Журнал аудита" }),
    ).toBeInTheDocument();
  });
});
