import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { MedicalProfileForm } from "./MedicalProfileForm";
import type { MedicalProfile } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const THREE_PLUS = "22222222-2222-4222-8222-222222222222";
const RETIRED = "33333333-3333-4333-8333-333333333333";

const OPTIONS = {
  items: [
    {
      id: THREE_PLUS,
      scale: "aed_switch_count",
      code: "3plus",
      name_ru: "3 и более",
      sort_order: 2,
      retired: false,
    },
    {
      id: RETIRED,
      scale: "aed_switch_count",
      code: "old",
      name_ru: "Прежняя шкала",
      sort_order: 3,
      retired: true,
    },
  ],
};

const PROFILE: MedicalProfile = {
  patient_id: PATIENT_ID,
  diagnosis: "Синдром Драве",
  epilepsy_type: "генерализованная",
  onset_age_months: 7,
  genetics: null,
  comorbidities: null,
  aed_switch_count_id: THREE_PLUS,
  updated_at: "2026-08-01T10:00:00Z",
} as MedicalProfile;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Регрессия: `PUT /medical-profile` заменяет профиль целиком, а поля «сколько
 * ПЭП сменил» в форме не было. Любая правка диагноза молча обнуляла значение —
 * и это при том, что семье на шаге «Лекарства» обещано, что заполнит его врач
 * (ADR-0007). Врач не видел ни прежнего значения, ни факта его потери.
 */
describe("медицинский профиль: число сменённых ПЭП", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({ data: OPTIONS, error: undefined });
    (api.PUT as Mock).mockResolvedValue({ data: PROFILE, error: undefined });
  });

  it("сохраняется при правке остальных полей, а не обнуляется", async () => {
    const user = userEvent.setup();
    render(
      <MedicalProfileForm
        patientId={PATIENT_ID}
        profile={PROFILE}
        onDone={() => {}}
        onCancel={() => {}}
      />,
      { wrapper },
    );

    await screen.findByRole("option", { name: "3 и более" });
    await user.clear(screen.getByLabelText(/Диагноз/));
    await user.type(screen.getByLabelText(/Диагноз/), "Уточнён");
    await user.click(screen.getByRole("button", { name: /Сохранить/ }));

    const call = (api.PUT as Mock).mock.calls.at(0);
    expect(call?.[1].body.aed_switch_count_id).toBe(THREE_PLUS);
    expect(call?.[1].body.diagnosis).toBe("Уточнён");
  });

  it("выведенный из употребления вариант остаётся в списке, пока он выбран", async () => {
    render(
      <MedicalProfileForm
        patientId={PATIENT_ID}
        profile={{ ...PROFILE, aed_switch_count_id: RETIRED }}
        onDone={() => {}}
        onCancel={() => {}}
      />,
      { wrapper },
    );

    // Скрыть выбранный вариант — значит подменить прежний ответ пустотой.
    expect(
      await screen.findByRole("option", { name: "Прежняя шкала" }),
    ).toBeInTheDocument();
  });
});
