import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { AssistantScreen } from "./AssistantScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
};
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

function message(overrides: Record<string, unknown> = {}) {
  return {
    seq: 1,
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

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<AssistantScreen session={SESSION} />, { wrapper: Wrapper });
}

async function ask(
  user: ReturnType<typeof userEvent.setup>,
  text = "куда записать кетоны",
) {
  // Поле включается, когда список переписок разрешился: до этого неизвестно,
  // есть ли открытый разговор, и вопрос ушёл бы с `conversation_id: null`.
  const field = await screen.findByLabelText(/куда записать кетоны/i);
  await waitFor(() => {
    expect(field).toBeEnabled();
  });
  await user.type(field, text);
  await user.click(screen.getByRole("button", { name: "Спросить" }));
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

/** Тот же класс символов, что принимает сервер (ADR-0035). */
const KEY_FORMAT = /^[\x21\x23-\x5b\x5d-\x7e]{1,255}$/;

describe("помощник в Mini App", () => {
  it("пока список переписок в полёте, спросить нельзя", async () => {
    // Иначе вопрос уйдёт с `conversation_id: null`, а повтор после потерянного
    // ответа — с найденным разговором: другое тело, другой ключ, второй вопрос.
    // Проверяется поле, а не кнопка: кнопку выключает и сама отправка.
    const pending = new Promise<never>(() => undefined);
    (api.GET as Mock).mockReturnValue(pending);
    renderScreen();

    expect(
      await screen.findByLabelText(/куда записать кетоны/i),
    ).toBeDisabled();
  });

  it("дисклеймер стоит под ответом, а не под вопросом семьи", async () => {
    // Раздел 10.4 ТЗ требует его под каждым ответом — и в чате тоже: помощник
    // здесь тот же, и вести себя иначе он не должен.
    const user = userEvent.setup();
    renderScreen();

    await ask(user);

    const notes = await screen.findAllByText(/не заменяет консультацию врача/i);
    expect(notes).toHaveLength(1);
  });

  it("вопрос уходит с идентификатором ребёнка", async () => {
    // Без него переписку не удалит `erase_patient` (ADR-0019), а врач не
    // увидит переписку своего пациента.
    const user = userEvent.setup();
    renderScreen();

    await ask(user);

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/ai/assistant/messages",
        expect.objectContaining({
          body: expect.objectContaining({ patient_id: SESSION.patientId }),
        }),
      );
    });
  });

  it("повтор после отказа идёт с тем же ключом, правка вопроса — с новым", async () => {
    // Ответ 202 мог потеряться уже после записи: по тому же ключу сервер
    // отдаст прежний ответ, а не заведёт второй вопрос в переписке и вторую
    // задачу воркера (ADR-0035).
    (api.POST as Mock).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderScreen();

    const field = await screen.findByLabelText(/куда записать кетоны/i);
    await waitFor(() => {
      expect(field).toBeEnabled();
    });
    await user.type(field, "куда записать кетоны");
    await user.click(screen.getByRole("button", { name: "Спросить" }));
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "Спросить" }));
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(2);
    });

    await user.type(field, " и вес");
    await user.click(screen.getByRole("button", { name: "Спросить" }));
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(3);
    });

    const keys = (api.POST as Mock).mock.calls.map(
      ([, options]) => options.params.header["Idempotency-Key"] as string,
    );
    expect(keys[0]).toMatch(KEY_FORMAT);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("исчерпанный предел выключает поле, а не предлагает повтор", async () => {
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "rate_limited", message: "На сегодня хватит." } },
      response: { status: 429 },
    });
    const user = userEvent.setup();
    renderScreen();

    await ask(user);

    await waitFor(() => {
      expect(screen.getByLabelText(/куда записать кетоны/i)).toBeDisabled();
    });
  });

  it("до первого вопроса за телом переписки не ходит", async () => {
    // Переписок у семьи нет вовсе.
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });

    renderScreen();

    expect(
      await screen.findByText(/как работает приложение/i),
    ).toBeInTheDocument();

    // Один запрос — за СПИСКОМ: без него приложение не знает, был ли разговор.
    expect(api.GET).toHaveBeenCalledTimes(1);
    expect((api.GET as Mock).mock.calls[0]?.[0]).toBe(
      "/api/v1/patients/{patient_id}/ai-conversations",
    );
  });

  it("открывается на последней переписке после перезапуска из чата", async () => {
    // Каждый запуск Mini App — новая загрузка страницы. Пока идентификатор жил
    // в состоянии экрана, переписка терялась ВСЕГДА: родитель спрашивал,
    // закрывал приложение и при следующем открытии видел пустой чат.
    (api.GET as Mock).mockImplementation((path: string) =>
      path.endsWith("/ai-conversations")
        ? Promise.resolve({
            data: { items: [{ id: CONVERSATION_ID }], total: 1 },
          })
        : Promise.resolve({
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
          }),
    );

    renderScreen();

    expect(await screen.findByText("куда записать кетоны")).toBeInTheDocument();
  });
});
