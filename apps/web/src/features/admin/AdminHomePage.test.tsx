import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { SectionRouter } from "../../test/SectionRouter";
import { AdminHomePage } from "./AdminHomePage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

function user(id: string, role: string, isActive: boolean) {
  return {
    id,
    email: `${id}@example.com`,
    full_name: `Пользователь ${id}`,
    phone: null,
    role,
    is_active: isActive,
    created_at: "2026-01-01T10:00:00Z",
  };
}

const USERS = {
  items: [
    user("a1", "admin", true),
    user("d1", "doctor", true),
    user("d2", "doctor", false),
    user("p1", "parent", true),
  ],
  total: 4,
};

const AUDIT = {
  items: [
    {
      id: "aud-1",
      user_id: "a1",
      action: "login",
      entity: "users",
      entity_id: "a1",
      before: null,
      after: null,
      ip: "127.0.0.1",
      created_at: "2026-08-30T10:15:00Z",
    },
  ],
  total: 1,
};

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="home">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }

  return render(<AdminHomePage />, { wrapper: Wrapper });
}

/**
 * Вход администратора вёл сразу в список учётных записей — один из четырёх
 * разделов, выбранный лишь тем, что он первый в меню
 * (`docs/DESIGN_PROPOSAL.md`).
 */
describe("главная администратора", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/admin/users")
        return { data: USERS, error: undefined };
      if (path === "/api/v1/admin/audit-log")
        return { data: AUDIT, error: undefined };
      return { data: { items: [], total: 128 }, error: undefined };
    });
  });

  it("считает учётные записи по ролям и называет отключённые отдельно", async () => {
    renderHome();

    // «Два врача», из которых один без доступа, — это не два врача.
    expect(
      await screen.findByText("1 (и ещё 1 без доступа)"),
    ).toBeInTheDocument();
  });

  it("берёт число позиций справочника из ответа, а не считает карточки", async () => {
    renderHome();

    // Тянуть тысячи карточек ради одного числа незачем: сервер отдаёт `total`.
    expect(await screen.findByText("128 позиций")).toBeInTheDocument();
  });

  it("показывает последние операции значениями справочника, а не кодами", async () => {
    renderHome();

    expect(await screen.findByText("Вход")).toBeInTheDocument();
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });
});
