import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { SessionProvider } from "./session";
import { useSession } from "./useSession";

vi.mock("../../lib/api", () => ({
  api: { POST: vi.fn() },
  setAccessToken: vi.fn(),
  // Провайдер подписывается на окончательное истечение сессии, чтобы увести
  // человека на вход. Подписка возвращает функцию отписки — её вызывает React
  // при размонтировании, и без неё тест падал бы на очистке эффекта.
  onSessionExpired: () => () => undefined,
}));

const { api } = await import("../../lib/api");

const PATIENT_KEY = ["patient", "p1", "overview"];

/** Токен без подписи: `readTokenClaims` разбирает полезную нагрузку. */
function token(sub: string): string {
  const payload = btoa(
    JSON.stringify({ sub, role: "parent", exp: 9999999999 }),
  );
  return `header.${payload}.signature`;
}

function Probe() {
  const { signIn, signOut } = useSession();

  return (
    <>
      <button type="button" onClick={() => void signOut()}>
        Выйти
      </button>
      <button type="button" onClick={() => signIn(token("second"))}>
        Войти другим
      </button>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Ответ, уже полученный прежним пользователем. Наблюдателя у него нет —
  // как и в жизни: при выходе кабинет размонтируется вместе со своими запросами.
  client.setQueryData(PATIENT_KEY, { patient_id: "p1" });

  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("сессия и кэш запросов", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.POST as unknown as Mock).mockResolvedValue({ data: {} });
  });

  it("выход очищает данные пациента из кэша", async () => {
    // Сервер чужого ребёнка не отдаёт (403), но показанный ранее ответ оставался
    // в кэше: после смены учётной записи одна семья видела карту другой, и экран
    // при этом выглядел исправным.
    const user = userEvent.setup();
    const client = renderProbe();

    await user.click(screen.getByRole("button", { name: "Выйти" }));

    expect(client.getQueryData(PATIENT_KEY)).toBeUndefined();
  });

  it("вход другим пользователем не оставляет данные предыдущего", async () => {
    const user = userEvent.setup();
    const client = renderProbe();

    await user.click(screen.getByRole("button", { name: "Войти другим" }));

    expect(client.getQueryData(PATIENT_KEY)).toBeUndefined();
  });
});
