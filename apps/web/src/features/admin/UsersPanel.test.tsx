import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { UsersPanel } from "./UsersPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "admin-1", role: "admin" } }),
}));

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const USERS = {
  items: [
    {
      id: "u1",
      full_name: "Ольга Диетолог",
      email: "olga@example.com",
      role: "dietitian",
      is_active: true,
      created_at: "2026-08-01T10:00:00Z",
    },
  ],
  total: 1,
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<UsersPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({ data: USERS });
});

describe("учётные записи", () => {
  it("ищет на сервере, а не по загруженной странице", async () => {
    // Список приходил двумя сотнями строк без поиска вовсе: найти учётку
    // человека, который звонит прямо сейчас, было нечем.
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("Ольга Диетолог");
    await user.type(screen.getByLabelText(/Поиск по имени/), "ольга");

    await waitFor(() => {
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/admin/users",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ q: "ольга" }),
          }),
        }),
      );
    });
  });

  it("отбирает по роли тем же запросом", async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("Ольга Диетолог");
    await user.selectOptions(screen.getByLabelText("Роль"), "doctor");

    await waitFor(() => {
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/admin/users",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ role: "doctor" }),
          }),
        }),
      );
    });
  });

  it("пустая выдача отбора предлагает его снять, а не выглядит пустой базой", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/Поиск по имени/), "кого нет");

    expect(
      await screen.findByText("По этому отбору никого нет"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Сбросить отбор" }).length,
    ).toBeGreaterThan(0);
  });
});
