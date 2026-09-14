import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import authRu from "../../locales/ru/auth.json";
import commonRu from "../../locales/ru/common.json";
import { LoginPage } from "./LoginPage";

const signIn = vi.fn();

vi.mock("./useSession", () => ({ useSession: () => ({ signIn }) }));

const post = vi.fn();
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: (...args: unknown[]) => post(...args) } };
});

i18n.addResourceBundle("ru", "auth", authRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<LoginPage />, { wrapper: Wrapper });
}

async function submitCredentials() {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText(/Электронная почта/),
    "doctor@example.com",
  );
  await user.type(screen.getByLabelText(/^Пароль/), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Войти" }));
  return user;
}

beforeEach(() => {
  post.mockReset();
  signIn.mockReset();
});

describe("вход со вторым фактором", () => {
  it("после почты и пароля спрашивает код и НЕ обвиняет в неверном коде", async () => {
    // Это первый экран, который видит врач. Пока «кода ещё не спрашивали» было
    // ошибкой, здесь появлялось красное «Неверный код подтверждения.» — на
    // действие, в котором человек не ошибся, и вслух для скринридера
    // (`role="alert"`).
    post.mockResolvedValue({
      data: { status: "totp_required", tokens: null, totp_setup_token: null },
    });

    renderPage();
    await submitCredentials();

    expect(
      await screen.findByLabelText(/Код из приложения-аутентификатора/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("неверный код показывает ошибку — это уже настоящая ошибка", async () => {
    post.mockResolvedValue({
      error: {
        error: { code: "unauthorized", message: "Неверный код подтверждения." },
      },
    });

    renderPage();
    await submitCredentials();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Неверный код подтверждения.",
    );
  });

  it("сломанный фактор просит резервный код и не предлагает код из приложения", async () => {
    // Состояние `totp_recovery_required`: секрет записан мимо приложения и не
    // разбирается. Поле кода здесь было бы приглашением в круг — код не
    // сойдётся никогда, сколько ни вводи.
    post.mockResolvedValue({
      data: {
        status: "totp_recovery_required",
        tokens: null,
        totp_setup_token: null,
      },
    });

    renderPage();
    await submitCredentials();

    expect(await screen.findByLabelText(/Резервный код/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Код из приложения-аутентификатора/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Ввести код из приложения/ }),
    ).not.toBeInTheDocument();
    // Человеку сказано, ЧТО случилось и что делать: без этого экран выглядит
    // как «система забыла мой второй фактор».
    expect(
      screen.getByText(/Вход по коду из приложения сломан/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/сбросит администратор клиники/),
    ).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("вход без второго фактора открывает кабинет сразу", async () => {
    post.mockResolvedValue({
      data: { status: "ok", tokens: { access_token: "a", refresh_token: "r" } },
    });

    renderPage();
    await submitCredentials();

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("a"));
  });
});
