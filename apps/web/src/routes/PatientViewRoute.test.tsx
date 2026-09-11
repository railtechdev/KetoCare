import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../lib/i18n";
import { api } from "../lib/api";
import calculatorRu from "../locales/ru/calculator.json";
import doctorRu from "../locales/ru/doctor.json";
import { patientKey } from "../features/patients/usePatient";
import { PatientRouter } from "../test/PatientRouter";
import { PatientViewRoute } from "./PatientViewRoute";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("../features/auth/useSession", () => ({
  useSession: () => ({ session: { userId: "d1", role: "doctor" } }),
}));

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);
i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

function overview(patientId: string, ratio: number) {
  return {
    patient_id: patientId,
    date: "2026-09-11",
    prescription: {
      id: `p-${patientId}`,
      patient_id: patientId,
      ratio,
      kcal_per_day: 1200,
      protein_min_g: 12,
      carbs_max_g: 35,
      meals_per_day: 3,
      starts_on: "2026-08-01",
      created_at: "2026-08-01T10:00:00Z",
    },
    day: null,
    last_ketone: null,
    last_weight: null,
    seizures_today: { entries: 0, count: 0 },
    seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
  };
}

/** Переключатель пациента: как в шапке карты — адрес меняется, раздел остаётся. */
function SwitchToSecond() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.history.push(`/app/patients/${SECOND}/calculator`)}
    >
      test: второй пациент
    </button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(
    async (
      path: string,
      options?: { params?: { path?: { patient_id?: string } } },
    ) => {
      const id = options?.params?.path?.patient_id ?? FIRST;
      if (path.endsWith("/overview")) {
        return {
          data: overview(id, id === SECOND ? 4 : 3.5),
          error: undefined,
        };
      }
      if (path === "/api/v1/patients/{patient_id}") {
        return {
          data: { id, full_name: `Пациент ${id.slice(0, 1)}` },
          error: undefined,
        };
      }
      return { data: { items: [], total: 0 }, error: undefined };
    },
  );
  (api.POST as Mock).mockResolvedValue({ data: undefined, error: undefined });
});

describe("раздел карты пациента", () => {
  it("другой пациент получает свой экран раздела, а не состояние прежнего", async () => {
    // Без ключа по пациенту React сохранял экран раздела: калькулятор держал
    // кетосоотношение прежнего ребёнка, и вердикт выносился против чужого
    // назначения. Цель подставляется из назначения, только пока поле пустое, —
    // поэтому сохранённый экран её не обновлял.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Второй пациент уже в кэше — так бывает, когда врач открывал его раньше
    // или его подгрузил поиск переключателя. Только тогда маршрут не отдаёт
    // пустоту на время загрузки, экран не размонтируется сам, и дефект виден.
    client.setQueryData(patientKey(SECOND), {
      id: SECOND,
      full_name: "Пациент 2",
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <PatientRouter patientId={FIRST} view="calculator">
          <SwitchToSecond />
          <PatientViewRoute />
        </PatientRouter>
      </QueryClientProvider>,
    );

    await waitFor(
      () => expect(screen.getByLabelText(/^Кетосоотношение/)).toHaveValue(3.5),
      { timeout: 5000 },
    );

    await user.click(
      screen.getByRole("button", { name: "test: второй пациент" }),
    );

    await waitFor(
      () => expect(screen.getByLabelText(/^Кетосоотношение/)).toHaveValue(4),
      { timeout: 5000 },
    );
  });
});
