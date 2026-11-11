import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { EnergyHint } from "./EnergyHint";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});
vi.mock("../patients/usePatient", () => ({
  usePatient: () => ({ data: { birth_date: "2020-01-15" } }),
}));
let weight: { weight_kg: number; occurred_at: string } | null = {
  weight_kg: 18,
  occurred_at: "2026-11-01T09:00:00Z",
};
vi.mock("../patients/overview", () => ({
  usePatientOverview: () => ({ data: { last_weight: weight } }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

function renderHint(onApply = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<EnergyHint patientId="p1" onApply={onApply} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return onApply;
}

describe("калорийность по весу и возрасту", () => {
  it("показывает диапазон и подставляет его середину", async () => {
    weight = { weight_kg: 18, occurred_at: "2026-11-01T09:00:00Z" };
    (api.POST as Mock).mockResolvedValue({
      data: {
        kcal_min: 1170,
        kcal_max: 1224,
        kcal_per_kg_min: 65,
        kcal_per_kg_max: 68,
        engine_version: "1.4.0",
      },
    });
    const onApply = renderHint();

    const apply = await screen.findByRole("button", {
      name: /Подставить 1\s?200 ккал/,
    });
    expect(screen.getByText(/1\s?170–1\s?224 ккал/)).toBeInTheDocument();
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(1200);
    expect((api.POST as Mock).mock.calls[0]![1].body.weight_kg).toBe(18);
  });

  it("без веса просит записать вес, а не молчит", async () => {
    vi.clearAllMocks();
    weight = null;
    renderHint();
    expect(
      await screen.findByText(doctorRu.prescription.energy.noWeight),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/calc/energy-requirement",
      expect.anything(),
    );
  });
});
