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
    expect(screen.getByText("Прежняя шкала частоты")).toBeInTheDocument();
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
