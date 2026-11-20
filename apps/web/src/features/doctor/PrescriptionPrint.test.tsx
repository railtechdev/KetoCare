import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { PrescriptionSheet } from "./PrescriptionPrint";
import type { Prescription } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ACTIVE = {
  ratio: 4,
  kcal_per_day: 1300,
  protein_g: 20,
  carbs_limit_g: 15,
  meals_per_day: 5,
  fluid_ml_per_day: 1500,
  restrictions: null,
  effective_from: "2026-11-15",
} as unknown as Prescription;

describe("prescription sheet (ADR-0092)", () => {
  it("prints the four numbers, the grams per meal and day, exclusions and signature lines", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: {
        day: { fat_g: 130, protein_g: 20, net_carbs_g: 12.5, non_fat_g: 32.5 },
        meal: { fat_g: 26, protein_g: 4, net_carbs_g: 2.5, non_fat_g: 6.5 },
        dietary_unit_kcal: 40,
        engine_version: "1.12.0",
      },
    });
    render(<PrescriptionSheet active={ACTIVE} excluded={["Арахис", "мёд"]} />, {
      wrapper,
    });

    expect(
      screen.getByRole("heading", { name: "Назначение на кетогенную диету" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4.0 : 1")).toBeInTheDocument();
    expect(screen.getByText(/1\s300 ккал/)).toBeInTheDocument();
    expect(screen.getByText("5 в день")).toBeInTheDocument();
    expect(screen.getByText(/1\s500 мл/)).toBeInTheDocument();

    expect(
      await screen.findByRole("row", { name: /Один приём 26,0 г 4,0 г 2,5 г/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /За день 130,0 г не меньше 20,0 г/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Арахис, мёд")).toBeInTheDocument();
    expect(screen.getByText("Подпись")).toBeInTheDocument();
  });
});
