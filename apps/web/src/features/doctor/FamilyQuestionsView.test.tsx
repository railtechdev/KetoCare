import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import assistantRu from "../../locales/ru/assistant.json";
import doctorRu from "../../locales/ru/doctor.json";
import type { PatientSearch } from "../../router";
import { PatientRouter } from "../../test/PatientRouter";
import { FamilyQuestionsView } from "./FamilyQuestionsView";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);
i18n.addResourceBundle("ru", "assistant", assistantRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ANSWERED = "22222222-2222-4222-8222-222222222222";
const REFUSED = "33333333-3333-4333-8333-333333333333";

function conversation(id: string, preview: string, refused: number) {
  return {
    id,
    patient_id: PATIENT_ID,
    channel: "web",
    created_at: "2026-10-04T09:00:00Z",
    updated_at: "2026-10-04T09:01:00Z",
    messages_count: 2,
    preview,
    refused_count: refused,
  };
}

function message(overrides: Record<string, unknown>) {
  return {
    seq: 0,
    id: crypto.randomUUID(),
    role: "assistant",
    text: "",
    created_at: "2026-10-04T09:00:00Z",
    status: "done",
    sources: [],
    blocked: false,
    ...overrides,
  };
}

function renderView(search: PatientSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PatientRouter patientId={PATIENT_ID} view="questions" search={search}>
          {children}
        </PatientRouter>
      </QueryClientProvider>
    );
  }
  return render(<FamilyQuestionsView patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(async (path: string) => {
    if (path.endsWith("/ai-conversations")) {
      return {
        data: {
          items: [
            conversation(REFUSED, "можно ли сыр при температуре", 1),
            conversation(ANSWERED, "куда записать кетоны", 0),
          ],
          total: 2,
        },
      };
    }
    return {
      data: {
        id: REFUSED,
        patient_id: PATIENT_ID,
        channel: "web",
        created_at: "2026-10-04T09:00:00Z",
        updated_at: "2026-10-04T09:01:00Z",
        messages: [
          message({
            seq: 0,
            role: "user",
            text: "можно ли сыр при температуре",
          }),
          message({
            seq: 1,
            text: "Этот вопрос нужно обсудить с лечащим врачом.",
            blocked: true,
            created_at: "2026-10-04T09:01:00Z",
          }),
        ],
      },
    };
  });
});

describe("вопросы семьи в карте пациента", () => {
  it("перечисляет разговоры семьи и подсвечивает те, где помощник отказал", async () => {
    renderView();

    const refused = await screen.findByRole("button", {
      name: /можно ли сыр при температуре/,
    });
    const answered = screen.getByRole("button", {
      name: /куда записать кетоны/,
    });

    // Отказ — вопрос, который ждёт человека: отмечен и словами, и полосой.
    expect(refused).toHaveAttribute("data-refused", "true");
    expect(
      within(refused).getByText("Помощник не ответил на 1 вопрос"),
    ).toBeInTheDocument();
    expect(answered).not.toHaveAttribute("data-refused");
    expect(within(answered).queryByText(/не ответил/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/В 1 разговоре помощник не ответил по существу/),
    ).toBeInTheDocument();
  });

  it("открывает разговор на чтение: вопрос, отказ и время, без поля ответа", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      await screen.findByRole("button", {
        name: /можно ли сыр при температуре/,
      }),
    );

    expect(
      await screen.findByText("Этот вопрос нужно обсудить с лечащим врачом."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Помощник не ответил по существу — вопрос ждёт специалиста.",
      ),
    ).toBeInTheDocument();
    // Время стоит над каждой репликой.
    expect(screen.getAllByText(/^Семья, /)).toHaveLength(1);
    expect(screen.getAllByText(/^Помощник, /)).toHaveLength(1);
    // Подпись «ответ по материалам» под отказом ложна — её нет.
    expect(screen.queryByText(assistantRu.disclaimer)).not.toBeInTheDocument();
    // Спрашивает только семья: у специалиста нет ни поля, ни кнопки отправки.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: assistantRu.send }),
    ).not.toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("открытый разговор живёт в адресе и возвращается к перечню", async () => {
    const user = userEvent.setup();
    renderView({ item: REFUSED });

    expect(
      await screen.findByText("Этот вопрос нужно обсудить с лечащим врачом."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Все вопросы семьи/ }));

    expect(
      await screen.findByRole("button", { name: /куда записать кетоны/ }),
    ).toBeInTheDocument();
  });

  it("пустой перечень объясняет, где семья задаёт вопросы", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderView();

    expect(
      await screen.findByText("Семья пока ничего не спрашивала"),
    ).toBeInTheDocument();
    expect(screen.getByText(/в приложении в Telegram/)).toBeInTheDocument();
  });
});
