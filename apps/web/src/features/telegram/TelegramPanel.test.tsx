import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import telegramRu from "../../locales/ru/telegram.json";
import { TelegramPanel } from "./TelegramPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "telegram", telegramRu, true, true);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PATIENT = "11111111-1111-1111-1111-111111111111";

function panel() {
  return render(<TelegramPanel patientId={PATIENT} childName="Аня" />, {
    wrapper,
  });
}

/**
 * Бот был запущен и НЕДОСТИЖИМ.
 *
 * Все три ручки привязки существовали с самого начала, были покрыты тестами и
 * описаны в ADR-0009 — а в кабинете не было ни одного экрана, который бы их
 * вызывал. Сам бот в приветствии просил нажать кнопку «Привязать Telegram»,
 * которой не существовало. Цепочка обрывалась на первом же шаге.
 */
describe("привязка Telegram", () => {
  beforeEach(() => {
    (api.GET as Mock).mockReset();
    (api.POST as Mock).mockReset();
    (api.GET as Mock).mockResolvedValue({ data: [], error: undefined });
  });

  it("без чатов объясняет, что делать, а не молчит", async () => {
    panel();

    expect(await screen.findByText("Чатов пока нет")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Получить код" }),
    ).toBeInTheDocument();
  });

  it("показывает код, срок его жизни и ссылку на бота", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: {
        code: "ABCD2345",
        expires_at: "2026-08-31T10:15:00Z",
        deep_link: "https://t.me/ketocare_bot?start=ABCD2345",
      },
      error: undefined,
    });

    panel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Получить код" }),
    );

    expect(await screen.findByText("ABCD2345")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть бота в Telegram" }),
    ).toHaveAttribute("href", "https://t.me/ketocare_bot?start=ABCD2345");
    // Срок называется явно: код молча перестаёт работать через четверть часа,
    // и без этой строки отказ бота выглядел бы поломкой.
    expect(screen.getByText(/Код действует до/)).toBeInTheDocument();
  });

  it("без имени бота показывает код и говорит, что делать с ним", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: {
        code: "ABCD2345",
        expires_at: "2026-08-31T10:15:00Z",
        deep_link: null,
      },
      error: undefined,
    });

    panel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Получить код" }),
    );

    expect(await screen.findByText("ABCD2345")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/отправьте этот код боту/)).toBeInTheDocument();
  });

  it("отозванные привязки в списке действующих не показываются", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          id: "a",
          patient_id: PATIENT,
          parent_id: "p",
          chat_id: 111,
          linked_at: "2026-08-01T10:00:00Z",
          revoked_at: null,
        },
        {
          id: "b",
          patient_id: PATIENT,
          parent_id: "p",
          chat_id: 222,
          linked_at: "2026-07-01T10:00:00Z",
          revoked_at: "2026-07-20T10:00:00Z",
        },
      ],
      error: undefined,
    });

    panel();

    expect(await screen.findByText("Чат 111")).toBeInTheDocument();
    expect(screen.queryByText("Чат 222")).not.toBeInTheDocument();
  });

  it("подтверждение отключения называет ребёнка", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          id: "a",
          patient_id: PATIENT,
          parent_id: "p",
          chat_id: 111,
          linked_at: "2026-08-01T10:00:00Z",
          revoked_at: null,
        },
      ],
      error: undefined,
    });

    panel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Отключить" }),
    );

    // Правило П14 канона: подтверждается исчезновение конкретного канала у
    // конкретного ребёнка, а не абстрактное «вы уверены?».
    await waitFor(() => {
      expect(
        screen.getByText("Отключить чат от профиля «Аня»?"),
      ).toBeInTheDocument();
    });
  });

  it("отказ сервера показывается, а не теряется", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: "forbidden",
          message: "Код привязки выпускает родитель.",
        },
      },
    });

    panel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Получить код" }),
    );

    expect(
      await screen.findByText("Код привязки выпускает родитель."),
    ).toBeInTheDocument();
  });
});
