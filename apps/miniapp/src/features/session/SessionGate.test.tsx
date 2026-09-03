import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import { notifySessionExpired } from "../../lib/api";
import { SessionGate } from "./SessionGate";

const launchData = vi.hoisted(() => vi.fn<() => string | null>());
const post = vi.hoisted(() => vi.fn());

const diagnosis = vi.hoisted(() =>
  vi.fn(() => ({ telegram: false, launchParams: false })),
);

vi.mock("../../lib/telegram", () => ({
  launchData,
  webApp: () => null,
  launchDiagnosis: diagnosis,
}));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: post } };
});

function renderGate() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <SessionGate>{(s) => <p>Кабинет {s.patientName}</p>}</SessionGate>,
    {
      wrapper: Wrapper,
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("вход в Mini App", () => {
  it("открывает кабинет по подписанной строке запуска", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue({
      data: {
        access_token: "a",
        refresh_token: "r",
        patient_id: "11111111-1111-4111-8111-111111111111",
        patient_name: "Амина",
      },
      response: { status: 200 },
    });

    renderGate();

    expect(await screen.findByText("Кабинет Амина")).toBeInTheDocument();
  });

  it("непривязанному чату показывает, как привязать, а не отказ", async () => {
    // Семья может это исправить сама, и приложение обязано сказать как.
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue({ error: {}, response: { status: 404 } });

    renderGate();

    expect(await screen.findByText(/ещё не привязан/)).toBeInTheDocument();
    expect(screen.getByText(/код привязки/)).toBeInTheDocument();
  });

  it("вне Telegram объясняет, откуда приложение открывается", async () => {
    // Строки запуска нет — обменивать нечего, и «повторить» тут не поможет.
    launchData.mockReturnValue(null);

    renderGate();

    expect(
      await screen.findByText(/открывается из Telegram/),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("называет причину: скрипт Telegram не загрузился", async () => {
    // Две причины выглядят одинаково, а лечатся по-разному. Без этой строки
    // разбор превращается в переписку вслепую — так и вышло на живом стенде.
    launchData.mockReturnValue(null);
    diagnosis.mockReturnValue({ telegram: false, launchParams: false });

    renderGate();

    expect(await screen.findByText(/загрузить Telegram/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram — нет/)).toBeInTheDocument();
  });

  it("называет причину: страницу открыли ссылкой, а не кнопкой", async () => {
    launchData.mockReturnValue(null);
    diagnosis.mockReturnValue({ telegram: true, launchParams: false });

    renderGate();

    expect(await screen.findByText(/открыли ссылкой/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram — есть/)).toBeInTheDocument();
  });

  it("прочий отказ даёт повтор, а не тупик", async () => {
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue({ error: {}, response: { status: 401 } });

    renderGate();

    expect(
      await screen.findByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  });
});

describe("истечение сессии посреди работы", () => {
  it("переоткрывает вход и честно называет отзыв привязки", async () => {
    // Отзыв привязки прежде выглядел как «проверьте связь» на каждом экране:
    // refresh мёртв, а истечение сессии не слушал никто (находка М4 аудита).
    launchData.mockReturnValue("user=...&hash=...");
    post.mockResolvedValue({
      data: {
        access_token: "a",
        refresh_token: "r",
        patient_id: "11111111-1111-4111-8111-111111111111",
        patient_name: "Амина",
      },
      response: { status: 200 },
    });
    renderGate();
    await screen.findByText(/Кабинет Амина/);

    // Привязку отозвали: повторный обмен строки запуска отвечает 404.
    post.mockResolvedValue({ error: {}, response: { status: 404 } });
    act(() => {
      notifySessionExpired();
    });

    expect(
      await screen.findByText(/Этот Telegram ещё не привязан/),
    ).toBeInTheDocument();
  });
});
