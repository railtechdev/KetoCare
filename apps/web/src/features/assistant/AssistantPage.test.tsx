import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import assistantRu from "../../locales/ru/assistant.json";
import { AssistantPage } from "./AssistantPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "assistant", assistantRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

function message(overrides: Record<string, unknown> = {}) {
  return {
    seq: 0,
    id: crypto.randomUUID(),
    role: "assistant",
    text: "Кетоны записываются кнопкой «Кетоны».",
    created_at: "2026-09-04T10:00:00Z",
    status: "done",
    sources: ["how-to-record-ketones"],
    blocked: false,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<AssistantPage patientId={PATIENT_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.POST as Mock).mockResolvedValue({
    data: { conversation_id: CONVERSATION_ID, question_seq: 0, reply_seq: 1 },
  });
  (api.GET as Mock).mockResolvedValue({
    data: {
      id: CONVERSATION_ID,
      messages: [
        message({
          seq: 0,
          role: "user",
          text: "куда записать кетоны",
          sources: [],
        }),
        message({ seq: 1 }),
      ],
    },
  });
});

describe("помощник в кабинете", () => {
  it("дисклеймер стоит под каждым ответом, а не один на экран", async () => {
    // Раздел 10.4 ТЗ требует его под КАЖДЫМ ответом. Проверяется на двух
    // ответах: с одним тест проходил бы и тогда, когда дисклеймер собран на
    // экране один раз.
    (api.GET as Mock).mockResolvedValue({
      data: {
        id: CONVERSATION_ID,
        messages: [
          message({ seq: 0, role: "user", text: "первый вопрос", sources: [] }),
          message({ seq: 1 }),
          message({ seq: 2, role: "user", text: "второй вопрос", sources: [] }),
          message({ seq: 3 }),
        ],
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/куда записать кетоны/i), "вопрос");
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    const notes = await screen.findAllByText(/не заменяет консультацию врача/i);
    expect(notes).toHaveLength(2);
  });

  it("показывает статью, на которую опирается ответ", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/куда записать кетоны/i), "вопрос");
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    expect(
      await screen.findByText(/how-to-record-ketones/),
    ).toBeInTheDocument();
  });

  it("исчерпанный предел выключает поле, а не показывает ошибку", async () => {
    // «На сегодня хватит» — это не сбой: предлагать повтор здесь значит
    // предлагать то, что не сработает.
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "rate_limited", message: "На сегодня хватит." } },
      response: { status: 429 },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/куда записать кетоны/i), "вопрос");
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/куда записать кетоны/i)).toBeDisabled();
    });
    expect(screen.getByText("На сегодня хватит.")).toBeInTheDocument();
  });

  it("пока ответа нет, на его месте ожидание", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: {
        id: CONVERSATION_ID,
        messages: [
          message({ seq: 0, role: "user", text: "вопрос", sources: [] }),
          message({ seq: 1, text: "", status: "pending", sources: [] }),
        ],
      },
    });
    const user = userEvent.setup();
    const { container } = renderPage();

    await user.type(screen.getByLabelText(/куда записать кетоны/i), "вопрос");
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
  });

  it("до первого вопроса объясняет, о чём спрашивать", async () => {
    renderPage();

    expect(
      await screen.findByText(/как работает приложение/i),
    ).toBeInTheDocument();
    // Переписки ещё нет — за ней не ходим.
    expect(api.GET).not.toHaveBeenCalled();
  });
});
