import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import invitationsRu from "../../locales/ru/invitations.json";
import { InvitationsList } from "./InvitationsList";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "invitations", invitationsRu, true, true);

const PENDING = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "family@example.com",
  role: "parent",
  status: "pending",
  expires_at: "2026-09-07T10:00:00Z",
  created_at: "2026-08-31T10:00:00Z",
  invited_by_name: "Иван Врач",
};

const ACCEPTED = {
  ...PENDING,
  id: "2",
  email: "done@example.com",
  status: "accepted",
};

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  return render(<InvitationsList />, { wrapper: Wrapper });
}

describe("список приглашений", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({
      data: { items: [PENDING, ACCEPTED], total: 2 },
      error: undefined,
    });
    (api.POST as Mock).mockResolvedValue({
      data: { ...PENDING, status: "revoked" },
      error: undefined,
    });
  });

  it("показывает состояние и срок действия", async () => {
    // Срок был виден только в момент выдачи, а состояние — нигде.
    renderList();
    expect(await screen.findByText("family@example.com")).toBeInTheDocument();
    expect(screen.getByText("ждёт")).toBeInTheDocument();
    expect(screen.getAllByText("2026-09-07")).toHaveLength(2);
  });

  it("не показывает ссылку повторно", async () => {
    renderList();
    // Список, показывающий токен, сам становится способом войти чужой учётной
    // записью.
    await screen.findByText("family@example.com");
    expect(document.body.textContent).not.toMatch(/token/i);
  });

  it("отзыв предлагается только у ждущего приглашения", async () => {
    renderList();
    // У принятого учётная запись уже создана, у истёкшего ссылка и так не
    // работает: кнопка обещала бы действие, которого нет.
    await screen.findByText("family@example.com");
    expect(screen.getAllByRole("button", { name: "Отозвать" })).toHaveLength(1);
  });

  it("отзыв подтверждается и называет адрес", async () => {
    renderList();
    const user = userEvent.setup();
    await screen.findByText("family@example.com");

    await user.click(screen.getByRole("button", { name: "Отозвать" }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "Отозвать приглашение для family@example.com?",
      }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Отозвать", hidden: false }),
    );

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/auth/invitations/{invitation_id}/revoke",
      expect.objectContaining({
        params: { path: { invitation_id: PENDING.id } },
      }),
    );
  });
});
