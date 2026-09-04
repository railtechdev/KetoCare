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
  await user.type(screen.getByLabelText(/куда записать кетоны/i), text);
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

describe("помощник в Mini App", () => {
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

  it("до первого вопроса за перепиской не ходит", async () => {
    renderScreen();

    expect(
      await screen.findByText(/как работает приложение/i),
    ).toBeInTheDocument();
    expect(api.GET).not.toHaveBeenCalled();
  });
});
