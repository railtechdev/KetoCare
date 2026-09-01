import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import invitationsRu from "../../locales/ru/invitations.json";
import { AcceptInvitePage } from "./AcceptInvitePage";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => ({}),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "invitations", invitationsRu, true, true);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<AcceptInvitePage />, { wrapper: Wrapper });
}

describe("приглашение без токена", () => {
  it("даёт выход на вход, а не оставляет в тупике", async () => {
    // Ссылка из мессенджера часто приходит обрезанной: карточка без единой
    // кнопки оставляла человека ни с чем (правило П15 канона).
    renderPage();

    expect(
      await screen.findByRole("button", { name: /Перейти ко входу/ }),
    ).toBeInTheDocument();
  });
});
