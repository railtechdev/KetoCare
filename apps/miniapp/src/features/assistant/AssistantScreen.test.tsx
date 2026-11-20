import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { applyLanguage } from "../../lib/i18n";
import { NetworkError } from "@ketocare/api-client";
import { api } from "../../lib/api";
import { createQueryClient } from "../../lib/queryClient";
import { AssistantScreen } from "./AssistantScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: true,
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
    source_articles: [
      { slug: "how-to-record-ketones", title: "Как записать кетоны" },
    ],
    blocked: false,
    ...overrides,
  };
}

function renderScreen() {
  const client = createQueryClient();
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
  const field = await screen.findByLabelText(/куда записать кетоны/i);
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
          source_articles: [],
        }),
        message({ seq: 1 }),
      ],
    },
  });
});

/** Тот же класс символов, что принимает сервер (ADR-0035). */
const KEY_FORMAT = /^[\x21\x23-\x5b\x5d-\x7e]{1,255}$/;

describe("помощник в Mini App", () => {
  it("под ответом — заголовки статей, а не имена файлов", async () => {
    // Ответ сервера несёт и `sources` (имена для сверки с журналом), и
    // `source_articles` с заголовками; семья читает заголовки
    // (test_assistant_sources_contract.py).
    const user = userEvent.setup();
    renderScreen();

    await ask(user);

    expect(
      await screen.findByRole("button", { name: "Как записать кетоны" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Источник:")).toBeInTheDocument();
    expect(screen.queryByText(/how-to-record-ketones/)).toBeNull();
  });

  it("вопрос уходит в найденную переписку, если список успел прийти", async () => {
    // Заморозка начинается с ОТПРАВКИ, а не с набора: иначе достаточно
    // набрать вопрос раньше, чем дочитался список, — и сервер заведёт вторую
    // переписку, а первая станет для семьи недостижимой (ADR-0022).
    let revealList: (value: unknown) => void = () => undefined;
    const listed = new Promise((resolve) => {
      revealList = resolve;
    });
    const answered = (api.GET as Mock).getMockImplementation();
    (api.GET as Mock).mockImplementation((path: string, options?: unknown) =>
      path.endsWith("/ai-conversations")
        ? listed
        : (answered?.(path, options) ??
          Promise.resolve({ data: { id: CONVERSATION_ID, messages: [] } })),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.type(
      await screen.findByLabelText(/куда записать кетоны/i),
      "куда записать кетоны",
    );
    revealList({ data: { items: [{ id: CONVERSATION_ID }], total: 1 } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Спросить" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Спросить" }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalled();
    });
    expect((api.POST as Mock).mock.calls[0]?.[1]?.body?.conversation_id).toBe(
      CONVERSATION_ID,
    );
  });

  it("повтор уходит с тем же разговором, даже если список дочитался позже", async () => {
    // Список переписок мог быть ещё не прочитан: вопрос уходит с пустым
    // `conversation_id`. Повтор обязан уйти с тем же — иначе тело другое, ключ
    // другой и в переписке появится второй такой же вопрос (ADR-0035).
    // Список переписок отвечает не сразу: `staleTime: Infinity` не даст
    // перезапросить его позже, поэтому первый же запрос держим открытым и
    // разрешаем вручную — ровно между отправками.
    let revealList: (value: unknown) => void = () => undefined;
    const listed = new Promise((resolve) => {
      revealList = resolve;
    });
    const answered = (api.GET as Mock).getMockImplementation();
    (api.GET as Mock).mockImplementation((path: string, options?: unknown) =>
      path.endsWith("/ai-conversations")
        ? listed
        : (answered?.(path, options) ??
          Promise.resolve({ data: { id: CONVERSATION_ID, messages: [] } })),
    );
    (api.POST as Mock).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderScreen();

    const field = await screen.findByLabelText(/куда записать кетоны/i);
    await user.type(field, "куда записать кетоны");
    await user.click(screen.getByRole("button", { name: "Спросить" }));
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(1);
    });

    // Список дочитался, пока человек смотрел на отказ: повтор всё равно
    // обязан уйти с тем разговором, с которым ушла первая попытка.
    revealList({ data: { items: [{ id: CONVERSATION_ID }], total: 1 } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Спросить" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Спросить" }));
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(2);
    });

    const sent = (api.POST as Mock).mock.calls.map(([, options]) => ({
      conversation: options.body.conversation_id,
      key: options.params.header["Idempotency-Key"] as string,
    }));
    expect(sent[0]?.conversation).toBeNull();
    expect(sent[1]?.conversation).toBeNull();
    expect(sent[1]?.key).toBe(sent[0]?.key);
  });

  it("без сети вопрос уходит и сразу отказывает словами", async () => {
    // Поле живое всегда: без связи запись не ждёт очереди, а отказывает —
    // ADR-0034. Замок вместо ответа был бы хуже дубля.
    const user = userEvent.setup();
    (api.POST as Mock).mockRejectedValue(new NetworkError());
    onlineManager.setOnline(false);
    try {
      renderScreen();

      await user.type(
        await screen.findByLabelText(/куда записать кетоны/i),
        "куда записать кетоны",
      );
      await user.click(screen.getByRole("button", { name: "Спросить" }));

      expect(await screen.findByText(/Проверьте интернет/)).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
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

  it("под отказом дисклеймера нет", async () => {
    // Тот же помощник и то же правило, что в кабинете: под отказом подпись о
    // происхождении ответа ложна (ADR-0022).
    (api.GET as Mock).mockResolvedValue({
      data: {
        id: CONVERSATION_ID,
        messages: [
          message({
            seq: 0,
            role: "user",
            text: "что нам принимать",
            sources: [],
            source_articles: [],
          }),
          message({
            seq: 1,
            text: "Этот вопрос нужно обсудить с лечащим врачом.",
            sources: [],
            source_articles: [],
            blocked: true,
          }),
        ],
      },
    });
    const user = userEvent.setup();
    renderScreen();

    await ask(user);

    expect(
      await screen.findByText(/обсудить с лечащим врачом/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/не заменяет консультацию врача/i),
    ).not.toBeInTheDocument();
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

    // К переписке — один запрос, за СПИСКОМ: без него приложение не знает,
    // был ли разговор. Перечень ведущих специалистов (кто прочтёт вопрос) —
    // другая ручка и сюда не считается.
    const conversationCalls = (api.GET as Mock).mock.calls
      .map(([path]) => path as string)
      .filter((path) => path.includes("ai-conversations"));
    expect(conversationCalls).toEqual([
      "/api/v1/patients/{patient_id}/ai-conversations",
    ]);
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
                  source_articles: [],
                }),
                message({ seq: 1 }),
              ],
            },
          }),
    );

    renderScreen();

    expect(await screen.findByText("куда записать кетоны")).toBeInTheDocument();
  });

  it("неполученный перечень разговоров — отказ с повтором, а не «пусто»", async () => {
    // Без этой ветки семья с перепиской видела «вопросов ещё не было».
    let fail = true;
    (api.GET as Mock).mockImplementation((path: string) =>
      path.endsWith("/ai-conversations")
        ? Promise.resolve(
            fail
              ? { error: { error: { code: "internal", message: "сбой" } } }
              : { data: { items: [{ id: CONVERSATION_ID }], total: 1 } },
          )
        : Promise.resolve({
            data: {
              id: CONVERSATION_ID,
              messages: [
                message({
                  seq: 0,
                  role: "user",
                  text: "куда записать кетоны",
                  sources: [],
                  source_articles: [],
                }),
              ],
            },
          }),
    );
    const user = userEvent.setup();
    renderScreen();

    // Запрос перечня повторяется клиентом один раз (`createQueryClient`).
    const retry = await screen.findByRole(
      "button",
      { name: "Повторить" },
      { timeout: 4000 },
    );
    expect(screen.queryByText(/Вопросов пока не было/)).toBeNull();

    fail = false;
    await user.click(retry);
    expect(await screen.findByText("куда записать кетоны")).toBeInTheDocument();
  });
});

describe("кто прочтёт вопрос (ADR-0022, решение Р1)", () => {
  function withCareTeam(team: unknown, phone: string | null = null) {
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("/doctors")) return Promise.resolve({ data: team });
      if (path === "/api/v1/letterhead") {
        return Promise.resolve({
          data: {
            text:
              phone === null
                ? null
                : {
                    name_uz: "Klinika",
                    short_name: "Клиника",
                    family_phone: phone,
                  },
            logo: null,
            fallback_name: "KetoCare",
            updated_at: null,
          },
        });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    });
  }

  it("одной строкой называет роли тех, кто ведёт ребёнка", async () => {
    withCareTeam([{ id: "d1", role: "doctor", full_name: "Иванова Анна" }]);
    renderScreen();

    expect(await screen.findByText("Вопросы видит врач")).toBeInTheDocument();
  });

  it("без имён называет обе роли, а не молчит", async () => {
    withCareTeam([]);
    renderScreen();

    expect(
      await screen.findByText("Вопросы видят врач и диетолог"),
    ).toBeInTheDocument();
  });

  it("«Кто именно» раскрывает имена, «о срочном звоните» и телефон клиники", async () => {
    withCareTeam(
      [
        { id: "d1", role: "doctor", full_name: "Иванова Анна Сергеевна" },
        { id: "d2", role: "dietitian", full_name: "Петров Борис" },
      ],
      "+998 71 123-45-67",
    );
    const user = userEvent.setup();
    renderScreen();

    const composer = (
      await screen.findByRole("button", { name: "Кто именно" })
    ).closest("form") as HTMLElement;
    const names = await within(composer).findByText(
      /Иванова Анна Сергеевна \(врач\) и Петров Борис \(диетолог\)/,
    );
    expect(names).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Кто именно" }));

    expect(names).toBeVisible();
    expect(
      within(composer).getByText(
        /Уведомлений они не получают — о срочном звоните/,
      ),
    ).toBeVisible();
    expect(
      await within(composer).findByRole("link", { name: "+998 71 123-45-67" }),
    ).toHaveAttribute("href", "tel:+998711234567");
  });

  it("на пустом экране имена, «о срочном звоните» и телефон видны без нажатий", async () => {
    // Решение Р1: в раскрытии И на пустом экране. Семья с первым вопросом
    // «Кто именно» ещё не нашла, а о срочном ей нужно знать до вопроса.
    withCareTeam(
      [{ id: "d1", role: "doctor", full_name: "Иванова Анна Сергеевна" }],
      "+998 71 123-45-67",
    );
    renderScreen();

    const starters = await screen.findByText("Например, спросите:");
    const empty = starters.closest("div.flex-col")
      ?.parentElement as HTMLElement;
    expect(
      await within(empty).findByText(
        "Вопросы прочтут Иванова Анна Сергеевна (врач).",
      ),
    ).toBeVisible();
    expect(
      within(empty).getByText(
        /Уведомлений они не получают — о срочном звоните/,
      ),
    ).toBeVisible();
    expect(
      await within(empty).findByRole("link", { name: "+998 71 123-45-67" }),
    ).toBeVisible();
  });

  it("на пустом экране без имён называет роли", async () => {
    withCareTeam([]);
    renderScreen();

    // Строка над полем и строка пустого экрана — обе о ролях.
    await waitFor(() => {
      expect(screen.getAllByText("Вопросы видят врач и диетолог")).toHaveLength(
        2,
      );
    });
  });
});

describe("переписка на телефоне (аудит Mini App 2026-11)", () => {
  /** Ответы сервера по пути; переписка уже есть. */
  function serve({
    messages,
    phone = null,
    article,
  }: {
    messages: unknown[] | (() => unknown[]);
    phone?: string | null;
    article?: unknown;
  }) {
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("/ai-conversations")) {
        return Promise.resolve({
          data: { items: [{ id: CONVERSATION_ID }], total: 1 },
        });
      }
      if (path.endsWith("/doctors")) return Promise.resolve({ data: [] });
      if (path === "/api/v1/letterhead") {
        return Promise.resolve({
          data: {
            text:
              phone === null
                ? null
                : { name_uz: "K", short_name: "K", family_phone: phone },
            logo: null,
            fallback_name: "KetoCare",
            updated_at: null,
          },
        });
      }
      if (path.startsWith("/api/v1/knowledge-base/")) {
        return Promise.resolve(
          article === undefined
            ? { error: { error: { code: "internal", message: "сбой" } } }
            : article === "gone"
              ? { error: { error: { code: "not_found", message: "нет" } } }
              : { data: article },
        );
      }
      return Promise.resolve({
        data: {
          id: CONVERSATION_ID,
          messages: typeof messages === "function" ? messages() : messages,
        },
      });
    });
  }

  const QUESTION = message({
    seq: 0,
    role: "user",
    text: "куда записать кетоны",
    sources: [],
    source_articles: [],
  });

  it("второго видимого заголовка «Разговор» нет — он только для чтения с экрана (П3)", async () => {
    serve({ messages: [QUESTION, message({ seq: 1 })] });
    renderScreen();

    await screen.findByText("куда записать кетоны");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Помощник",
    );
    expect(screen.getByRole("heading", { name: "Разговор" })).toHaveClass(
      "sr-only",
    );
  });

  it("жирный из ответа — жирным, без звёздочек (П5)", async () => {
    serve({
      messages: [
        QUESTION,
        message({ seq: 1, text: "**Важно:** кнопка «Кетоны» на главной." }),
      ],
    });
    renderScreen();

    const strong = await screen.findByText("Важно:");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("ожидание ответа — словами «Помощник отвечает…» (П6)", async () => {
    serve({
      messages: [
        QUESTION,
        message({ seq: 1, text: "", status: "pending", source_articles: [] }),
      ],
    });
    renderScreen();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Помощник отвечает…",
    );
  });

  it("пока ждём ответ, дочитывает только новое — с места ожидания (П8)", async () => {
    // Воркер кладёт ответ НА МЕСТО ожидания с тем же seq: чтение «после
    // последнего» его бы не увидело.
    let answered = false;
    serve({
      messages: () =>
        answered
          ? [message({ seq: 1, text: "Ответ пришёл." })]
          : [
              QUESTION,
              message({
                seq: 1,
                text: "",
                status: "pending",
                source_articles: [],
              }),
            ],
    });
    renderScreen();

    await screen.findByText("Помощник отвечает…");
    answered = true;

    expect(
      await screen.findByText("Ответ пришёл.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    // Вопрос из первого чтения остался — ответ лёг рядом, а не вместо всего.
    expect(screen.getByText("куда записать кетоны")).toBeInTheDocument();
    const polls = (api.GET as Mock).mock.calls.filter(([path]) =>
      (path as string).endsWith("/{conversation_id}"),
    );
    expect(polls.at(-1)?.[1]?.params?.query).toEqual({ after_seq: 0 });
    expect(polls[0]?.[1]?.params?.query).toBeUndefined();
  });

  it("между днями — подпись дня (П8)", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    serve({
      messages: [
        message({
          seq: 0,
          role: "user",
          text: "старый вопрос",
          created_at: yesterday.toISOString(),
          source_articles: [],
        }),
        message({ seq: 1, created_at: yesterday.toISOString() }),
        message({
          seq: 2,
          role: "user",
          text: "новый вопрос",
          created_at: now.toISOString(),
          source_articles: [],
        }),
        message({ seq: 3, created_at: now.toISOString() }),
      ],
    });
    renderScreen();

    await screen.findByText("новый вопрос");
    expect(screen.getByText("Вчера")).toBeInTheDocument();
    expect(screen.getByText("Сегодня")).toBeInTheDocument();
  });

  it("источник открывает статью панелью, текст статьи — без разметки (П7)", async () => {
    serve({
      messages: [QUESTION, message({ seq: 1 })],
      article: {
        slug: "how-to-record-ketones",
        title: "Как записать кетоны",
        kind: "product",
        body_md: "## Где кнопка\n\nНа главной — **Кетоны**.",
      },
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Как записать кетоны" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Кетоны")).toHaveProperty(
      "tagName",
      "STRONG",
    );
    expect(within(dialog).queryByText(/##/)).toBeNull();
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/knowledge-base/articles/{slug}",
      { params: { path: { slug: "how-to-record-ketones" } } },
    );

    await user.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("не открылась статья — отказ с повтором", async () => {
    serve({ messages: [QUESTION, message({ seq: 1 })] });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Как записать кетоны" }),
    );

    expect(
      await screen.findByText(
        "Не удалось открыть статью",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
  });

  it("статьи больше нет — так и сказано, без «проверьте связь» и повтора", async () => {
    serve({ messages: [QUESTION, message({ seq: 1 })], article: "gone" });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Как записать кетоны" }),
    );

    expect(
      await screen.findByText(
        "Этой статьи больше нет в материалах приложения.",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Не удалось открыть статью")).toBeNull();
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("оговорка под ответом — короткой строкой, под каждым ответом", async () => {
    serve({
      messages: [
        QUESTION,
        message({ seq: 1 }),
        message({ seq: 2, role: "user", text: "ещё", source_articles: [] }),
        message({ seq: 3 }),
      ],
    });
    renderScreen();

    await screen.findByText("ещё");
    expect(screen.getAllByText("Не заменяет консультацию врача.")).toHaveLength(
      2,
    );
  });

  it("отклонённый вопрос — своим видом, к врачу и телефон клиники (П4)", async () => {
    serve({
      messages: [
        QUESTION,
        message({
          seq: 1,
          text: "Этот вопрос нужно обсудить с лечащим врачом.",
          blocked: true,
          source_articles: [],
        }),
      ],
      phone: "+998 71 200-00-00",
    });
    const { container } = renderScreen();

    await screen.findByText("Этот вопрос нужно обсудить с лечащим врачом.");
    expect(container.querySelector('[data-refusal="true"]')).not.toBeNull();
    expect(screen.getByText("Спросите врача на приёме.")).toBeInTheDocument();
    const call = await screen.findByRole("link", { name: "+998 71 200-00-00" });
    expect(call).toHaveAttribute("href", "tel:+998712000000");
    expect(
      screen.queryByRole("button", { name: "Спросить ещё раз" }),
    ).toBeNull();
  });

  it("недоступность — «Спросить ещё раз» тем же вопросом и новым ключом (П4)", async () => {
    serve({
      messages: [
        QUESTION,
        message({
          seq: 1,
          text: "Помощник сейчас недоступен.",
          status: "failed",
          source_articles: [],
        }),
      ],
    });
    const user = userEvent.setup();
    renderScreen();

    const retry = await screen.findByRole("button", {
      name: "Спросить ещё раз",
    });
    expect(screen.queryByText("Спросите врача на приёме.")).toBeNull();
    await user.click(retry);
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(1);
    });
    const [, options] = (api.POST as Mock).mock.calls[0] ?? [];
    expect(options.body).toEqual({
      patient_id: SESSION.patientId,
      conversation_id: CONVERSATION_ID,
      text: "куда записать кетоны",
    });
    expect(options.params.header["Idempotency-Key"]).toMatch(KEY_FORMAT);
  });

  it("повтор после недоступности недоступен, пока исчерпан предел", async () => {
    serve({
      messages: [
        QUESTION,
        message({
          seq: 1,
          text: "Помощник сейчас недоступен.",
          status: "failed",
          source_articles: [],
        }),
      ],
    });
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "rate_limited", message: "На сегодня хватит." } },
      response: { status: 429 },
    });
    const user = userEvent.setup();
    renderScreen();

    const retry = await screen.findByRole("button", {
      name: "Спросить ещё раз",
    });
    await user.click(retry);

    await waitFor(() => {
      expect(retry).toBeDisabled();
    });
  });
  it("исчерпанный предел — без «спросите врача» и без телефона (П4)", async () => {
    // Текст предела говорит «завтра»; совет к врачу отправил бы вопрос о
    // приложении тому, кто на них не отвечает.
    serve({
      messages: [
        QUESTION,
        message({
          seq: 1,
          text: "Дневной лимит ИИ-помощника исчерпан. Он обновится завтра.",
          blocked: true,
          limited: true,
          source_articles: [],
        }),
      ],
      phone: "+998 71 200-00-00",
    });
    const { container } = renderScreen();

    await screen.findByText(/Он обновится завтра/);
    expect(container.querySelector('[data-refusal="true"]')).not.toBeNull();
    expect(screen.queryByText("Спросите врача на приёме.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Спросить ещё раз" }),
    ).toBeNull();
  });

  it("телефон клиники — высотой в касание, а не в строку", async () => {
    serve({
      messages: [
        QUESTION,
        message({
          seq: 1,
          text: "Этот вопрос нужно обсудить с лечащим врачом.",
          blocked: true,
          source_articles: [],
        }),
      ],
      phone: "+998 71 200-00-00",
    });
    renderScreen();

    const call = await screen.findByRole("link", { name: "+998 71 200-00-00" });
    // `min-height` на строчной ссылке не действует — нужна блочная.
    expect(call).toHaveClass("inline-flex", "min-h-touch");
  });

  it("панель статьи — с отступами безопасной зоны Telegram", async () => {
    serve({
      messages: [QUESTION, message({ seq: 1 })],
      article: {
        slug: "how-to-record-ketones",
        title: "Как записать кетоны",
        kind: "product",
        body_md: "Текст.",
      },
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Как записать кетоны" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("pt-(--safe-top,0px)", "pb-(--safe-bottom,0px)");
  });
});

describe("прокрутка к концу переписки (П1)", () => {
  const scroll = vi.fn();

  beforeEach(() => {
    scroll.mockReset();
    Element.prototype.scrollIntoView = scroll;
    // Поле вопроса — 120 px; длинный ответ — 1000 px, прочее — 60 px.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const height = this.textContent?.includes("Длинный ответ")
          ? 1000
          : this.querySelector("textarea") !== null &&
              !this.textContent?.includes("куда записать кетоны")
            ? 120
            : 60;
        return { height, width: 360, top: 0, left: 0 } as DOMRect;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error — в jsdom прокрутки нет, заглушка снимается
    delete Element.prototype.scrollIntoView;
  });

  function serveConversation(messages: () => unknown[]) {
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("/ai-conversations")) {
        return Promise.resolve({
          data: { items: [{ id: CONVERSATION_ID }], total: 1 },
        });
      }
      if (path.endsWith("/doctors")) return Promise.resolve({ data: [] });
      if (path === "/api/v1/letterhead") {
        return Promise.resolve({
          data: {
            text: null,
            logo: null,
            fallback_name: "K",
            updated_at: null,
          },
        });
      }
      return Promise.resolve({
        data: { id: CONVERSATION_ID, messages: messages() },
      });
    });
  }

  const QUESTION = message({
    seq: 0,
    role: "user",
    text: "куда записать кетоны",
    sources: [],
    source_articles: [],
  });

  it("конец переписки встаёт над полем вопроса, а не под ним", async () => {
    serveConversation(() => [QUESTION, message({ seq: 1 })]);
    renderScreen();

    await screen.findByText("Кетоны записываются кнопкой «Кетоны».");
    await waitFor(() => {
      expect(scroll).toHaveBeenCalledWith({ block: "end" });
    });
    const end = scroll.mock.contexts.at(-1) as HTMLElement;
    // Высота поля и зазор: без них конец вставал на нижний край окна — под
    // поле и полосу вкладок, и новый ответ приходилось искать пальцем.
    expect(end.style.scrollMarginBottom).toBe("128px");
  });

  it("пришёл ответ — прокручивает к нему ещё раз", async () => {
    let answered = false;
    serveConversation(() =>
      answered
        ? [message({ seq: 1, text: "Ответ пришёл." })]
        : [
            QUESTION,
            message({
              seq: 1,
              text: "",
              status: "pending",
              source_articles: [],
            }),
          ],
    );
    renderScreen();

    await screen.findByText("Помощник отвечает…");
    await waitFor(() => {
      expect(scroll).toHaveBeenCalled();
    });
    const before = scroll.mock.calls.length;
    answered = true;

    await screen.findByText("Ответ пришёл.", {}, { timeout: 5000 });
    await waitFor(() => {
      expect(scroll.mock.calls.length).toBeGreaterThan(before);
    });
    expect(scroll.mock.calls.at(-1)).toEqual([{ block: "end" }]);
  });

  it("длинный ответ показывается с начала, а не с конца", async () => {
    serveConversation(() => [
      QUESTION,
      message({ seq: 1, text: "Длинный ответ, выше экрана." }),
    ]);
    renderScreen();

    await screen.findByText("Длинный ответ, выше экрана.");
    await waitFor(() => {
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
    });
    const answer = scroll.mock.contexts.at(-1) as HTMLElement;
    expect(answer).toHaveTextContent("Длинный ответ, выше экрана.");
    expect(scroll).not.toHaveBeenCalledWith({ block: "end" });
  });
});

describe("пустой экран: о чём спросить (П7, решение Р5)", () => {
  beforeEach(() => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
  });

  it("шесть готовых вопросов, нажатие сразу задаёт вопрос", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(
      await screen.findByText(/О здоровье ребёнка спрашивайте врача/),
    ).toBeInTheDocument();
    const starters = screen
      .getByText("Например, спросите:")
      .parentElement?.querySelectorAll("button");
    expect(starters).toHaveLength(6);

    await user.click(
      screen.getByRole("button", { name: "Как записать приступ?" }),
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledTimes(1);
    });
    expect((api.POST as Mock).mock.calls[0]?.[1]?.body?.text).toBe(
      "Как записать приступ?",
    );
  });

  it("по-узбекски кнопка подписана по-узбекски, а вопрос уходит по-русски", async () => {
    // База знаний русская: узбекский вопрос находил бы меньше.
    applyLanguage("uz");
    try {
      const user = userEvent.setup();
      renderScreen();

      expect(await screen.findByText(/faqat rus tilida/)).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Xurujni qanday yozish kerak?" }),
      );

      await waitFor(() => {
        expect(api.POST).toHaveBeenCalledTimes(1);
      });
      expect((api.POST as Mock).mock.calls[0]?.[1]?.body?.text).toBe(
        "Как записать приступ?",
      );
    } finally {
      applyLanguage("ru");
    }
  });
});

describe("суточный предел вопросов", () => {
  it("в полночь поле включается само", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 20, 23, 59, 30));
    try {
      (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
      (api.POST as Mock).mockResolvedValue({
        error: {
          error: { code: "rate_limited", message: "На сегодня хватит." },
        },
        response: { status: 429 },
      });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderScreen();

      await ask(user);
      await waitFor(() => {
        expect(screen.getByLabelText(/куда записать кетоны/i)).toBeDisabled();
      });

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/куда записать кетоны/i)).toBeEnabled();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
