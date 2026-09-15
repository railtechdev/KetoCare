import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import accessRu from "../../locales/ru/access.json";
import invitationsRu from "../../locales/ru/invitations.json";
import { JoinPage } from "./JoinPage";

const navigate = vi.fn();
let search: { code?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => search,
}));

const post = vi.fn();
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: (...args: unknown[]) => post(...args) } };
});

i18n.addResourceBundle("ru", "access", accessRu, true, true);
i18n.addResourceBundle("ru", "invitations", invitationsRu, true, true);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<JoinPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  post.mockReset();
  navigate.mockReset();
  search = {};
});

describe("активация кода доступа семьёй", () => {
  it("код из адреса подставлен: семья ничего не набирает", async () => {
    // Родитель приходит по QR или ссылке от врача. Поле всё равно показывается:
    // ссылка из мессенджера часто приходит обрезанной.
    search = { code: "TRWX4K92" };

    renderPage();

    expect(await screen.findByLabelText(/Код от врача/)).toHaveValue(
      "TRWX4K92",
    );
  });

  it("заполненная форма заводит учётную запись и ведёт ко входу", async () => {
    const user = userEvent.setup();
    search = { code: "TRWX4K92" };
    post.mockResolvedValue({
      data: { id: "u1", role: "parent", email: "mama@example.com" },
      error: undefined,
    });

    renderPage();
    await user.type(
      screen.getByLabelText("Электронная почта"),
      "mama@example.com",
    );
    await user.type(screen.getByLabelText("Имя и фамилия"), "Мама Ани");
    await user.type(
      screen.getByLabelText("Пароль"),
      "совершенно новый пароль 42",
    );
    await user.type(
      screen.getByLabelText("Пароль ещё раз"),
      "совершенно новый пароль 42",
    );
    await user.click(
      screen.getByRole("button", { name: "Создать учётную запись" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/auth/access-codes/activate", {
        body: {
          code: "TRWX4K92",
          email: "mama@example.com",
          full_name: "Мама Ани",
          password: "совершенно новый пароль 42",
          phone: null,
        },
      }),
    );

    // Сессии здесь не выдаётся: человек входит сам, как и после приглашения.
    expect(
      await screen.findByRole("button", { name: "Перейти ко входу" }),
    ).toBeInTheDocument();
  });

  it("негодный код показывает одно сообщение и оставляет форму", async () => {
    const user = userEvent.setup();
    search = { code: "TRWX4K92" };
    post.mockResolvedValue({
      error: {
        error: {
          code: "not_found",
          message:
            "Код недействителен или истёк. Попросите у врача новый код доступа.",
        },
      },
    });

    renderPage();
    await user.type(
      screen.getByLabelText("Электронная почта"),
      "mama@example.com",
    );
    await user.type(screen.getByLabelText("Имя и фамилия"), "Мама");
    await user.type(
      screen.getByLabelText("Пароль"),
      "совершенно новый пароль 42",
    );
    await user.type(
      screen.getByLabelText("Пароль ещё раз"),
      "совершенно новый пароль 42",
    );
    await user.click(
      screen.getByRole("button", { name: "Создать учётную запись" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Код недействителен или истёк/,
    );
    // Форма на месте: человеку есть куда ввести новый код.
    expect(screen.getByLabelText(/Код от врача/)).toBeInTheDocument();
  });
});
