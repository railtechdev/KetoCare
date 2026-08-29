import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import intakeRu from "../../locales/ru/intake.json";
import { IntakeForm } from "./IntakeForm";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn() } };
});

i18n.addResourceBundle("ru", "intake", intakeRu, true, true);

const OPTIONS = [
  {
    id: "o-onset",
    scale: "onset_age",
    code: "onset_0_6m",
    name_ru: "0-6 мес",
    sort: 0,
  },
  {
    id: "o-freq",
    scale: "seizure_frequency",
    code: "freq_daily",
    name_ru: "Ежедневно",
    sort: 1,
  },
  {
    id: "o-dur",
    scale: "seizure_duration",
    code: "dur_under_1min",
    name_ru: "До 1 мин",
    sort: 2,
  },
  {
    id: "o-meals",
    scale: "meals_per_day",
    code: "meals_3",
    name_ru: "3 приёма пищи",
    sort: 3,
  },
];

const DRUGS = [
  { id: "d-1", name_ru: "Конвулекс, Депакин", synonyms: ["Депакин"], sort: 0 },
  { id: "d-2", name_ru: "Клоназепам", synonyms: ["Клоназепам"], sort: 1 },
];

function respond(path: string) {
  if (path === "/api/v1/dictionaries/intake-options") {
    return { data: { items: OPTIONS, total: OPTIONS.length } };
  }
  if (path === "/api/v1/dictionaries/aed-drugs") {
    return { data: { items: DRUGS, total: DRUGS.length } };
  }
  if (path === "/api/v1/patients/{patient_id}/intake") {
    // Анкеты ещё нет — сервер отвечает 404, и это не ошибка экрана.
    return {
      error: {
        error: { code: "not_found", message: "Анкета ещё не заполнена." },
      },
    };
  }
  throw new Error(`Unexpected GET ${path}`);
}

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <IntakeForm patientId="p1" childName="Аня" onDone={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("IntakeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(respond(path)),
    );
    (api.PUT as unknown as Mock).mockResolvedValue({
      data: { id: "i1", patient_id: "p1", current_aed_ids: [] },
    });
  });

  it("незаполненная анкета — пустая форма, а не сообщение об ошибке", async () => {
    renderForm();

    expect(await screen.findByText(/Шаг 1 из 3/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ведёт по шагам вперёд и назад", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Далее" }));
    expect(screen.getByText(/Шаг 2 из 3/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByText(/Шаг 1 из 3/)).toBeInTheDocument();
  });

  it("«не отвечено» уходит на сервер как null, а не как пустая строка", async () => {
    // Пустой ответ и ответ «нет» — разные вещи: по первому нельзя делать
    // выводов, а второй утверждает отсутствие.
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(
      await screen.findByLabelText(/Как часто бывают приступы/),
      "o-freq",
    );
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("button", { name: "Сохранить анкету" }));

    const body = (api.PUT as unknown as Mock).mock.calls[0]?.[1]?.body;
    expect(body.seizure_frequency_id).toBe("o-freq");
    expect(body.onset_age_id).toBeNull();
    expect(body.developmental_delay).toBeNull();
    expect(body.last_seizure_on).toBeNull();
  });

  it("препараты отмечаются флажками и уходят списком", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("checkbox", { name: "Клоназепам" }));
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("button", { name: "Сохранить анкету" }));

    const body = (api.PUT as unknown as Mock).mock.calls[0]?.[1]?.body;
    expect(body.current_aed_ids).toEqual(["d-2"]);
  });

  it("врачебные поля в анкете семьи не показываются", async () => {
    // Диагноз, тип приступов и число сменённых препаратов заполняет врач:
    // заказчик просил объективности, и форма семьи о них даже не спрашивает.
    const user = userEvent.setup();
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Далее" }));

    expect(screen.queryByLabelText(/Диагноз/)).toBeNull();
    expect(screen.queryByLabelText(/сменил/)).toBeNull();
    expect(screen.getByText(/заполняет врач/)).toBeInTheDocument();
  });
});
