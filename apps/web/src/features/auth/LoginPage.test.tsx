import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

function renderPage(initialEmail?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<LoginPage initialEmail={initialEmail} />, {
    wrapper: Wrapper,
  });
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

  it("фокус уходит в появившееся поле кода (правило П21)", async () => {
    // Иначе человек с клавиатуры остаётся на кнопке «Войти» и о новом поле
    // узнаёт, только пройдя форму заново.
    post.mockResolvedValue({
      data: { status: "totp_required", tokens: null, totp_setup_token: null },
    });

    renderPage();
    const user = await submitCredentials();

    const code = await screen.findByLabelText(
      /Код из приложения-аутентификатора/,
    );
    await waitFor(() => expect(code).toHaveFocus());

    // Переключение на резервный код переносит фокус и в его поле.
    await user.click(
      screen.getByRole("button", { name: authRu.login.useBackupCode }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(authRu.login.backupCode)).toHaveFocus(),
    );
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

  it("повтор уже принятого кода называет причину и что делать (Н8)", async () => {
    // Код одноразовый: врач, вошедший с ним минуту назад в другой вкладке,
    // должен понять, что ждать следующего кода, а не перепроверять цифры.
    const reused =
      "Этот код уже использован. Дождитесь следующего кода в приложении.";
    post.mockResolvedValue({
      error: {
        error: {
          code: "unauthorized",
          message: reused,
          details: { reason: "totp_reused" },
        },
      },
    });

    renderPage();
    await submitCredentials();

    expect(await screen.findByRole("alert")).toHaveTextContent(reused);
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

  it("исправленный адрес снимает сообщение о поломке", async () => {
    // Состояние принадлежит учётной записи, а не вкладке. Пока оно переживало
    // смену адреса, здоровому врачу предлагали сжечь одноразовый резервный код.
    post.mockResolvedValueOnce({
      data: {
        status: "totp_recovery_required",
        tokens: null,
        totp_setup_token: null,
      },
    });
    post.mockResolvedValueOnce({
      data: { status: "totp_required", tokens: null, totp_setup_token: null },
    });

    renderPage();
    const user = await submitCredentials();
    expect(await screen.findByLabelText(/Резервный код/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(
      await screen.findByLabelText(/Код из приложения-аутентификатора/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Вход по коду из приложения сломан/),
    ).not.toBeInTheDocument();
  });

  it("вход без второго фактора открывает кабинет сразу", async () => {
    post.mockResolvedValue({
      data: { status: "ok", tokens: { access_token: "a", refresh_token: "r" } },
    });

    renderPage();
    await submitCredentials();

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("a"));
  });

  it("после создания учётной записи почта уже подставлена", () => {
    // Человек только что завёл учётную запись по приглашению или коду —
    // набирать почту второй раз незачем.
    renderPage("new@example.com");

    expect(screen.getByLabelText(/Электронная почта/)).toHaveValue(
      "new@example.com",
    );
  });
});

describe("сводка ошибок входа (правило П8)", () => {
  it("пустая форма: сводка забирает фокус, строки ведут в поля", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Войти" }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveFocus();
    expect(
      within(summary).getByText(commonRu.form.errorSummary),
    ).toBeInTheDocument();

    const links = within(summary).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      authRu.login.emailInvalid,
      authRu.login.passwordRequired,
    ]);

    await user.click(links[1]!);
    expect(screen.getByLabelText(/^Пароль/)).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });
});
