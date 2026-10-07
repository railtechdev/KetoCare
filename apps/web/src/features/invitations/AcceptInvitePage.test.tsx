import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import invitationsRu from "../../locales/ru/invitations.json";
import { AcceptInvitePage } from "./AcceptInvitePage";

const navigate = vi.fn();
let search: { token?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => search,
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

beforeEach(() => {
  vi.clearAllMocks();
  search = {};
});

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

describe("приглашение по ссылке", () => {
  it("называет почту, на которую заводится учётная запись", async () => {
    search = { token: "tok" };
    (api.POST as Mock).mockResolvedValue({
      data: { email: "doc@example.com" },
    });
    renderPage();

    expect(await screen.findByText(/doc@example\.com/)).toBeInTheDocument();
  });

  it("устаревшая ссылка говорит, что делать, — до заполнения формы", async () => {
    // Прежде человек заполнял имя и пароль и только после «Создать» видел
    // красную строку без выхода.
    search = { token: "old" };
    (api.POST as Mock).mockResolvedValue({
      error: {
        error: {
          code: "not_found",
          message: "Приглашение недействительно или истекло.",
        },
      },
    });
    renderPage();

    expect(
      await screen.findByText(invitationsRu.accept.expiredTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Перейти ко входу/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Пароль ещё раз/)).toBeNull();
  });
});
