import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../lib/i18n";
import authRu from "../../locales/ru/auth.json";
import commonRu from "../../locales/ru/common.json";
import { TotpSetupPanel } from "./TotpSetupPanel";

const signIn = vi.fn();

vi.mock("./useSession", () => ({ useSession: () => ({ signIn }) }));

const post = vi.fn();
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: (...args: unknown[]) => post(...args) } };
});

i18n.addResourceBundle("ru", "auth", authRu, true, true);
i18n.addResourceBundle("ru", "common", commonRu, true, true);

const onRestart = vi.fn();

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <TotpSetupPanel setupToken="setup-token" onRestart={onRestart} />,
    {
      wrapper: Wrapper,
    },
  );
}

/** Ответ на /auth/totp/setup — секрет-кандидат и ссылка для QR. */
const SETUP = {
  data: {
    secret: "JBSWY3DPEHPK3PXP",
    provisioning_uri: "otpauth://totp/KetoCare:doctor?secret=JBSWY3DPEHPK3PXP",
  },
};

async function confirmCode() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Код из приложения/), "123456");
  await user.click(screen.getByRole("button", { name: /Подтвердить и войти/ }));
  return user;
}

beforeEach(() => {
  post.mockReset();
  signIn.mockReset();
  onRestart.mockReset();
});

describe("первичная настройка второго фактора", () => {
  it("временный пароль ведёт к заданию своего, а не в кабинет", async () => {
    // Пароль выдал администратор, и он его знает. Сессии сервер здесь не даёт:
    // иначе настройка фактора была бы обходом временного пароля.
    post.mockResolvedValueOnce(SETUP).mockResolvedValueOnce({
      data: {
        tokens: null,
        backup_codes: ["aaa-111", "bbb-222"],
        password_reset_token: "reset-token",
      },
    });

    renderPanel();
    const user = await confirmCode();

    // Сначала коды: показать их второй раз невозможно.
    expect(await screen.findByText("aaa-111")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Я сохранил коды/ }));

    expect(
      await screen.findByRole("heading", { name: "Задайте свой пароль" }),
    ).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("обычная настройка по-прежнему открывает кабинет", async () => {
    post.mockResolvedValueOnce(SETUP).mockResolvedValueOnce({
      data: {
        tokens: { access_token: "a", refresh_token: "r" },
        backup_codes: ["aaa-111"],
        password_reset_token: null,
      },
    });

    renderPanel();
    const user = await confirmCode();

    expect(await screen.findByText("aaa-111")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Я сохранил коды/ }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("a"));
  });

  it("истёкший токен шага — понятные слова и «Начать вход заново»", async () => {
    // Прежде под полем стояло общее «что-то пошло не так», а повтор с тем же
    // токеном отказывал снова: выхода из шага не было до перезагрузки.
    post.mockResolvedValueOnce({
      error: { error: { code: "unauthorized", message: "Токен истёк." } },
    });
    const user = userEvent.setup();
    renderPanel();

    expect(
      await screen.findByRole("heading", { name: authRu.stepExpired.title }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: authRu.stepExpired.restart }),
    );
    expect(onRestart).toHaveBeenCalled();
  });

  it("пока ключа нет, кнопка выключена и называет причину", async () => {
    post.mockReturnValueOnce(new Promise(() => {}));
    renderPanel();

    const button = await screen.findByRole("button", {
      name: /Подтвердить и войти/,
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(authRu.totpSetup.waitingForKey),
    ).toBeInTheDocument();
  });

  it("истёкший токен задания пароля тоже ведёт ко входу", async () => {
    post
      .mockResolvedValueOnce(SETUP)
      .mockResolvedValueOnce({
        data: {
          tokens: null,
          backup_codes: ["aaa-111"],
          password_reset_token: "reset-token",
        },
      })
      .mockResolvedValueOnce({
        error: { error: { code: "unauthorized", message: "Токен истёк." } },
      });
    renderPanel();
    const user = await confirmCode();
    await user.click(
      await screen.findByRole("button", { name: /Я сохранил коды/ }),
    );
    await user.type(
      await screen.findByLabelText("Новый пароль"),
      "длинный-пароль-1",
    );
    await user.type(
      screen.getByLabelText("Новый пароль ещё раз"),
      "длинный-пароль-1",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить и войти" }));

    expect(
      await screen.findByRole("heading", { name: authRu.stepExpired.title }),
    ).toBeInTheDocument();
  });
});
