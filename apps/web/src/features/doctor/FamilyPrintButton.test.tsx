import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { FamilyPrintButton } from "./FamilyPrintButton";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function answer(prescriptions: unknown[]) {
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/patients/{patient_id}") {
      return Promise.resolve({
        data: { id: PATIENT_ID, full_name: "Аня Иванова" },
      });
    }
    if (path === "/api/v1/patients/{patient_id}/prescriptions") {
      return Promise.resolve({
        data: { items: prescriptions, total: prescriptions.length },
      });
    }
    if (path === "/api/v1/patients/{patient_id}/menus/week") {
      return Promise.resolve({ data: { days: [] } });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("печать для семьи", () => {
  it("называет, что будет на листе, и без назначения и меню говорит почему", async () => {
    // Аудит продукта 12.11.2026: «Печать для семьи» печатала назначение и
    // меню недели, а без них гасла молча (правило П44).
    answer([]);
    render(<FamilyPrintButton patientId={PATIENT_ID} />, { wrapper });

    const button = await screen.findByRole("button", {
      name: doctorRu.familyPrint.button,
    });
    const reason = await screen.findByText(doctorRu.familyPrint.nothing);
    expect(button).toBeDisabled();
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("с назначением печатается и причины не пишет", async () => {
    answer([
      {
        id: "rx1",
        patient_id: PATIENT_ID,
        ratio: 4,
        kcal_per_day: 1200,
        protein_g: 26,
        carbs_limit_g: 10,
        meals_per_day: 4,
        restrictions: null,
        author_id: "u1",
        effective_from: "2026-08-01",
        created_at: "2026-08-01T09:00:00Z",
      },
    ]);
    render(<FamilyPrintButton patientId={PATIENT_ID} />, { wrapper });

    const button = await screen.findByRole("button", {
      name: doctorRu.familyPrint.button,
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText(doctorRu.familyPrint.nothing)).toBeNull();
  });
});
