import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { MedicationsTab } from "./MedicationsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "d1", role: "doctor" } }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DRUG_ID = "22222222-2222-4222-8222-222222222222";

let medications: unknown[] = [];

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<MedicationsTab patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  medications = [];
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("/medications")) {
      return Promise.resolve({
        data: { items: medications, total: medications.length },
      });
    }
    if (path.includes("aed-drugs")) {
      return Promise.resolve({
        data: {
          items: [{ id: DRUG_ID, name_ru: "Вальпроат натрия", retired: false }],
        },
      });
    }
    if (path.includes("/intake")) {
      return Promise.resolve({ data: { current_aed_ids: [DRUG_ID] } });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
});

describe("препараты из анкеты семьи", () => {
  it("предлагает перенести в схему то, что назвала семья", async () => {
    // Семья перечислила ПЭП при регистрации, схему пишет врач — связи между
    // анкетой и `medications` не было никакой.
    renderTab();

    expect(
      await screen.findByRole("button", { name: /Вальпроат натрия/ }),
    ).toBeInTheDocument();
  });

  it("подставляет название в форму, но не заводит препарат сам", async () => {
    // Назначение препарата — врачебное решение: доза и режим приёма в анкете
    // не названы и взяться им неоткуда.
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: /Вальпроат натрия/ }),
    );

    expect(
      await screen.findByDisplayValue("Вальпроат натрия"),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("не предлагает то, что уже есть в схеме", async () => {
    medications = [
      {
        id: "m1",
        patient_id: PATIENT_ID,
        drug_name: "Вальпроат натрия",
        dose: "300 мг",
        frequency: "2 раза в день",
        started_at: "2026-08-01",
        stopped_at: null,
      },
    ];

    renderTab();

    await screen.findByText("300 мг");
    expect(
      screen.queryByRole("button", { name: /^Вальпроат натрия$/ }),
    ).not.toBeInTheDocument();
  });
});
