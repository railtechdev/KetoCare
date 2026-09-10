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
    id: "o-freq-none",
    scale: "seizure_frequency",
    code: "freq_none",
    name_ru: "Приступов нет",
    sort: 2,
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

/** Сохранённая анкета; `null` — сервер отвечает 404 «ещё не заполнена». */
let saved: Record<string, unknown> | null = null;

function respond(path: string) {
  if (path === "/api/v1/dictionaries/intake-options") {
    return { data: { items: OPTIONS, total: OPTIONS.length } };
  }
  if (path === "/api/v1/dictionaries/aed-drugs") {
    return { data: { items: DRUGS, total: DRUGS.length } };
  }
  if (path === "/api/v1/patients/{patient_id}/intake") {
    if (saved !== null) return { data: saved };
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

beforeEach(() => {
  saved = null;
});

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

/**
 * «Приступов нет» без даты — ответ, который ничего не говорит.
 *
 * Ответ клиники 09.09.2026 (вопрос 19): устойчивая свобода от приступов
 * измеряется СРОКОМ. Правило живёт на сервере, здесь оно видно заранее —
 * иначе семья узнавала бы о нём отказом после «Сохранить», на последнем шаге
 * и без подсказки, куда возвращаться.
 */
describe("свобода от приступов измеряется сроком", () => {
  it("не пускает дальше, пока не указана дата последнего приступа", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(
      await screen.findByLabelText(intakeRu.fields.frequency),
      "o-freq-none",
    );
    await user.click(screen.getByRole("button", { name: intakeRu.next }));

    expect(
      screen.getByText(intakeRu.errors.lastSeizureRequired),
    ).toBeInTheDocument();
    // Остались на том же шаге: ошибка стоит здесь, уводить с неё нельзя.
    expect(
      screen.getByLabelText(intakeRu.fields.frequency),
    ).toBeInTheDocument();
  });

  it("с датой пропускает дальше", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(
      await screen.findByLabelText(intakeRu.fields.frequency),
      "o-freq-none",
    );
    await user.type(
      screen.getByLabelText(intakeRu.fields.lastSeizureOn),
      "2026-06-01",
    );
    await user.click(screen.getByRole("button", { name: intakeRu.next }));

    expect(
      screen.queryByText(intakeRu.errors.lastSeizureRequired),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(intakeRu.fields.frequency),
    ).not.toBeInTheDocument();
  });

  it("на уже заполненной анкете ошибка видна сразу", async () => {
    // Семья открывает анкету, чтобы поправить питание, а упирается в дату,
    // которой не вводила. Показать это надо на первом шаге, а не отказом после
    // «Сохранить»: иначе она пройдёт три шага и вернётся ни с чем.
    saved = {
      seizure_frequency_id: "o-freq-none",
      last_seizure_on: null,
      current_aed_ids: [],
    };
    renderForm();

    // Именно «сразу»: до всякого нажатия. С проверкой после клика тест был бы
    // зелёным и на экране, который показывает ошибку только после отказа, —
    // то есть проверял бы не то, что обещает названием.
    expect(
      await screen.findByText(intakeRu.errors.lastSeizureRequired),
    ).toBeInTheDocument();
  });

  it("другие варианты частоты даты не требуют", async () => {
    // Ребёнок с ежедневными приступами и так есть в дневнике, а семья на
    // первом визите даты может не помнить.
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(
      await screen.findByLabelText(intakeRu.fields.frequency),
      "o-freq",
    );
    await user.click(screen.getByRole("button", { name: intakeRu.next }));

    expect(
      screen.queryByText(intakeRu.errors.lastSeizureRequired),
    ).not.toBeInTheDocument();
  });
});
