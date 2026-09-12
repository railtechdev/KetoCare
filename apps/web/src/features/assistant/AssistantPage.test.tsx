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

/** Тот же класс символов, что принимает сервер (ADR-0035). */
const KEY_FORMAT = /^[\x21\x23-\x5b\x5d-\x7e]{1,255}$/;

describe("помощник в кабинете", () => {
  it("пока список переписок в полёте, спросить нельзя", async () => {
    // Иначе вопрос уйдёт с `conversation_id: null`, а повтор после потерянного
    // ответа — с найденным разговором: другое тело, другой ключ, второй вопрос.
    // Проверяется поле, а не кнопка: кнопку выключает и сама отправка.
    const pending = new Promise<never>(() => undefined);
    (api.GET as Mock).mockReturnValue(pending);
    renderPage();

    expect(
      await screen.findByLabelText(/куда записать кетоны/i),
    ).toBeDisabled();
  });

  it("повтор после отказа идёт с тем же ключом, правка вопроса — с новым", async () => {
    // Ответ 202 мог потеряться уже после записи: по тому же ключу сервер
    // отдаст прежний ответ, а не заведёт второй вопрос в переписке и вторую
    // задачу воркера (ADR-0035).
    (api.POST as Mock).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderPage();

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

    const composer = await screen.findByLabelText(/куда записать кетоны/i);
    await waitFor(() => {
      expect(composer).toBeEnabled();
    });
    await user.type(composer, "вопрос");
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    const notes = await screen.findAllByText(/не заменяет консультацию врача/i);
    expect(notes).toHaveLength(2);
  });

  it("показывает статью, на которую опирается ответ", async () => {
    const user = userEvent.setup();
    renderPage();

    const composer = await screen.findByLabelText(/куда записать кетоны/i);
    await waitFor(() => {
      expect(composer).toBeEnabled();
    });
    await user.type(composer, "вопрос");
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

    const composer = await screen.findByLabelText(/куда записать кетоны/i);
    await waitFor(() => {
      expect(composer).toBeEnabled();
    });
    await user.type(composer, "вопрос");
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

    const composer = await screen.findByLabelText(/куда записать кетоны/i);
    await waitFor(() => {
      expect(composer).toBeEnabled();
    });
    await user.type(composer, "вопрос");
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
  });

  it("до первого вопроса объясняет, о чём спрашивать", async () => {
    // Переписок у семьи нет вовсе.
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });

    renderPage();

    expect(
      await screen.findByText(/как работает приложение/i),
    ).toBeInTheDocument();

    // Один запрос — за СПИСКОМ переписок: без него экран не знает, был ли
    // разговор раньше. За телом переписки не ходим: её идентификатора нет.
    expect(api.GET).toHaveBeenCalledTimes(1);
    expect((api.GET as Mock).mock.calls[0]?.[0]).toBe(
      "/api/v1/patients/{patient_id}/ai-conversations",
    );
  });

  it("открывается на последней переписке, а не с чистого листа", async () => {
    // Раньше идентификатор жил только в состоянии экрана: родитель спрашивал,
    // получал ответ, уходил в другой раздел — и, вернувшись, видел пустой чат.
    // Разговор при этом лежал на сервере и был доступен лечащему врачу
    // (ADR-0022), то есть семья единственная не могла его перечитать.
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

    renderPage();

    expect(await screen.findByText("куда записать кетоны")).toBeInTheDocument();
  });
});
