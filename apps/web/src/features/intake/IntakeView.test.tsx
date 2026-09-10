import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import intakeRu from "../../locales/ru/intake.json";
import { IntakeView } from "./IntakeView";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "intake", intakeRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ONSET = "22222222-2222-4222-8222-222222222222";
const RETIRED_FREQ = "33333333-3333-4333-8333-333333333333";
const DAILY_FREQ = "66666666-6666-4666-8666-666666666666";
const DRUG = "44444444-4444-4444-8444-444444444444";

const OPTIONS = {
  items: [
    {
      id: ONSET,
      scale: "onset_age",
      code: "6-12m",
      name_ru: "6-12 мес",
      sort_order: 2,
      retired: false,
    },
    {
      id: RETIRED_FREQ,
      scale: "seizure_frequency",
      code: "old",
      name_ru: "Прежняя шкала частоты",
      sort_order: 9,
      retired: true,
    },
    {
      id: DAILY_FREQ,
      scale: "seizure_frequency",
      code: "freq_daily",
      name_ru: "Ежедневно",
      sort_order: 1,
      retired: false,
    },
  ],
};

const DRUGS = {
  items: [
    { id: DRUG, code: "vpa", name_ru: "Вальпроевая кислота", retired: false },
  ],
};

const INTAKE = {
  id: "55555555-5555-4555-8555-555555555555",
  patient_id: PATIENT_ID,
  last_seizure_on: "2026-07-15",
  onset_age_id: ONSET,
  seizure_frequency_id: RETIRED_FREQ,
  baseline_seizure_frequency_id: RETIRED_FREQ,
  seizure_duration_id: null,
  meals_per_day_id: null,
  developmental_delay: true,
  meals_regular: false,
  current_aed_ids: [DRUG],
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-01T10:00:00Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockGet(intake: unknown | "missing") {
  (api.GET as Mock).mockImplementation(async (path: string) => {
    if (path.includes("intake-options"))
      return { data: OPTIONS, error: undefined };
    if (path.includes("aed-drugs")) return { data: DRUGS, error: undefined };
    return intake === "missing"
      ? {
          data: undefined,
          error: { error: { code: "not_found", message: "нет" } },
        }
      : { data: intake, error: undefined };
  });
}

/**
 * Анкета — базовый анамнез до старта терапии, и врачу она не показывалась
 * нигде: ручка ему открыта, интерфейса чтения не было. Точка отсчёта для
 * оценки эффективности диеты — частота приступов ДО неё — в карте
 * отсутствовала, и врач собирал тот же анамнез заново на приёме.
 */
describe("анкета глазами специалиста", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показывает ответы семьи, расшифровывая справочники", async () => {
    mockGet(INTAKE);
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    expect(await screen.findByText("6-12 мес")).toBeInTheDocument();
    expect(screen.getByText("15.07.2026")).toBeInTheDocument();
    expect(screen.getByText("Вальпроевая кислота")).toBeInTheDocument();

    // Выведенный из употребления вариант всё равно называется: показать
    // прочерк вместо прежнего ответа семьи — значит подменить её ответ.
    // Строк две — текущая частота и исходная: у этого ребёнка они совпадают.
    expect(screen.getAllByText("Прежняя шкала частоты")).toHaveLength(2);
  });

  it("неотвеченный вопрос называет словами, а не прочерком", async () => {
    mockGet(INTAKE);
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    // Прочерк у «длительности приступа» читался бы как «приступов не бывает».
    await screen.findByText("6-12 мес");
    expect(screen.getAllByText("Не отвечено").length).toBeGreaterThan(0);
  });

  it("незаполненную анкету показывает пустым состоянием, а не ошибкой", async () => {
    mockGet("missing");
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    // 404 здесь означает «ещё не заполнена»: сообщение о сбое заставило бы
    // врача искать поломку там, где её нет.
    expect(await screen.findByText("Анкета не заполнена")).toBeInTheDocument();
    expect(
      screen.queryByText(/Не удалось загрузить анкету/),
    ).not.toBeInTheDocument();
  });
});

/**
 * Исходная частота — точка отсчёта, по которой судят об эффекте терапии
 * (ответ клиники 09.09.2026, вопрос 19). Записывается один раз и только пока
 * терапия не началась, поэтому у строки три разных смысла — и все три врач
 * обязан различать. «Не изменилась» и «сравнивать не с чем» — противоположные
 * вещи, а раньше обе прятали строку и выглядели одинаково.
 */
describe("исходная частота приступов", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показывает прежнее значение, когда текущая от него ушла", async () => {
    mockGet({
      ...INTAKE,
      baseline_seizure_frequency_id: DAILY_FREQ,
      seizure_frequency_id: RETIRED_FREQ,
    });
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    expect(
      await screen.findByText(intakeRu.fields.baselineFrequency),
    ).toBeInTheDocument();
    expect(screen.getByText("Ежедневно")).toBeInTheDocument();
  });

  it("показывает то же значение, когда частота не изменилась", async () => {
    // Точка отсчёта есть, и она равна сегодняшней: это ответ «улучшения нет»,
    // а не отсутствие данных. Спрятанная строка выдавала бы его за второе.
    mockGet({
      ...INTAKE,
      baseline_seizure_frequency_id: DAILY_FREQ,
      seizure_frequency_id: DAILY_FREQ,
    });
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    expect(
      await screen.findByText(intakeRu.fields.baselineFrequency),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Ежедневно")).toHaveLength(2);
  });

  it("называет факт, что точки отсчёта нет, а не причину", async () => {
    // Врачу нужно знать, что снижение относительно исходного посчитать не с
    // чем. ПОЧЕМУ её нет, экран не знает: причин несколько (впервые ответили
    // уже на терапии; анкету правили после старта; назначение выписали задним
    // числом), и клиенту причина не приходит вовсе — назвать вероятную значило
    // бы утверждать о ребёнке больше, чем известно.
    mockGet({ ...INTAKE, baseline_seizure_frequency_id: null });
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    expect(
      await screen.findByText(intakeRu.fields.baselineNotRecorded),
    ).toBeInTheDocument();
    expect(screen.queryByText(/терапия уже шла/)).not.toBeInTheDocument();
  });

  it("записанную, но безымянную не выдаёт за отсутствующую", async () => {
    // Вариант ответа исчез из справочника: путь почти невозможен (внешний ключ
    // с `ON DELETE RESTRICT`), но точка отсчёта у ребёнка ЕСТЬ, и сказать
    // «не зафиксирована» значило бы соврать в клинически значимой строке.
    mockGet({
      ...INTAKE,
      baseline_seizure_frequency_id: "99999999-9999-4999-8999-999999999999",
    });
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    expect(
      await screen.findByText(intakeRu.fields.baselineUnnamed),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(intakeRu.fields.baselineNotRecorded),
    ).not.toBeInTheDocument();
  });

  it("не заводит строку, пока про частоту не отвечали вовсе", async () => {
    // Незаданный вопрос — это «Не отвечено» у самой частоты, и второй строкой
    // про точку отсчёта его повторять незачем.
    mockGet({
      ...INTAKE,
      seizure_frequency_id: null,
      baseline_seizure_frequency_id: null,
    });
    render(<IntakeView patientId={PATIENT_ID} />, { wrapper });

    await screen.findByText(intakeRu.fields.frequency);
    expect(
      screen.queryByText(intakeRu.fields.baselineFrequency),
    ).not.toBeInTheDocument();
  });
});
