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

/** Ответ сводки: считает база, а не экран. */
const OVERVIEW = {
  users: [
    { role: "admin", active: 1, inactive: 0 },
    { role: "doctor", active: 1, inactive: 1 },
    { role: "dietitian", active: 0, inactive: 0 },
    { role: "parent", active: 1, inactive: 0 },
  ],
  products_total: 128,
  products_active: 120,
  products_stale: 4,
  stale_after_days: 365,
  invitations_pending: 2,
  invitations_expired: 1,
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
      if (path === "/api/v1/admin/overview")
        return { data: OVERVIEW, error: undefined };
      if (path === "/api/v1/admin/audit-log")
        return { data: AUDIT, error: undefined };
      return { data: { items: [], total: 0 }, error: undefined };
    });
  });

  it("считает учётные записи по ролям и называет отключённые отдельно", async () => {
    renderHome();

    // «Два врача», из которых один без доступа, — это не два врача.
    expect(
      await screen.findByText("1 (и ещё 1 без доступа)"),
    ).toBeInTheDocument();
  });

  it("берёт числа справочника у сервера, а не считает карточки", async () => {
    renderHome();

    // Считает база: пересчёт первых двухсот строк на клиенте переставал быть
    // правдой ровно на большой установке.
    expect(await screen.findByText(/128 позиций/)).toBeInTheDocument();
    expect(screen.getByText(/в обороте: 120/)).toBeInTheDocument();
  });

  it("зовёт перепроверить позиции, которые давно не сверялись", async () => {
    // Счётчик без перехода к самим позициям был бы тупиком: порог говорит
    // «пора перепроверить», а сделать это можно только в списке.
    renderHome();

    const link = await screen.findByRole("link", { name: /не сверялись/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("products"));
  });

  it("называет невостребованные приглашения", async () => {
    // Пока приглашение живо, по ссылке из него заводится учётная запись.
    renderHome();

    expect(await screen.findByText(/2 действующих/)).toBeInTheDocument();
    expect(screen.getByText(/1 просрочено/)).toBeInTheDocument();
  });

  it("показывает последние операции значениями справочника, а не кодами", async () => {
    renderHome();

    expect(await screen.findByText("Вход")).toBeInTheDocument();
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });
});
