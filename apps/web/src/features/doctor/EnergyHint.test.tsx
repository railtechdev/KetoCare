import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { EnergyHint } from "./EnergyHint";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});
let birthDate = "2020-01-15";
vi.mock("../patients/usePatient", () => ({
  usePatient: () => ({ data: { birth_date: birthDate } }),
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

const FIVE_YEARS_18_KG = {
  kcal_min: 1170,
  kcal_max: 1224,
  kcal_per_kg_min: 65,
  kcal_per_kg_max: 68,
  protein_g: 18,
  protein_g_per_kg: 1,
  fluid_ml: 1400,
  engine_version: "1.11.0",
};

function lastBody() {
  const calls = (api.POST as Mock).mock.calls;
  return calls[calls.length - 1]![1].body as {
    age_years: number;
    weight_kg: number;
  };
}

describe("калорийность по весу и возрасту", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    birthDate = "2020-01-15";
    weight = { weight_kg: 18, occurred_at: "2026-11-01T09:00:00Z" };
    (api.POST as Mock).mockResolvedValue({ data: FIVE_YEARS_18_KG });
  });

  it("даёт выбрать минимум, середину или максимум диапазона", async () => {
    const onApply = renderHint();

    expect(
      await screen.findByRole("button", { name: /Мин\. 1\s?170/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Середина 1\s?200/ }),
    ).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: /Макс\. 1\s?224/ });
    expect(screen.getByText(/1\s?170–1\s?224 ккал/)).toBeInTheDocument();
    // Строки таблиц по возрасту видны рядом с итогом.
    expect(
      screen.getByText(/65–68 ккал и белок 1 г на кг/),
    ).toBeInTheDocument();
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith({
      kcal: 1224,
      proteinG: 18,
      proteinPerKg: 1,
      fluidMl: 1400,
    });
    expect(lastBody().weight_kg).toBe(18);
  });

  it("считает от веса, который врач поставил для расчёта, и возвращает взвешенный", async () => {
    renderHint();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Вес для расчёта, кг");
    expect(field).toHaveValue(18);

    await user.clear(field);
    await user.type(field, "20");
    await vi.waitFor(() => expect(lastBody().weight_kg).toBe(20));
    // Измеренный вес назван, а не потерян: подмена видна.
    expect(screen.getByText(/Изменён для расчёта/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Вернуть 18/ }));
    expect(field).toHaveValue(18);
    expect(screen.queryByText(/Изменён для расчёта/)).not.toBeInTheDocument();
  });

  it("без взвешиваний даёт ввести вес, а не останавливает подсказку", async () => {
    weight = null;
    renderHint();
    expect(
      await screen.findByText(doctorRu.prescription.energy.noWeight),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Вес для расчёта, кг"), "18");
    expect(
      await screen.findByRole("button", { name: /Мин\. 1\s?170/ }),
    ).toBeInTheDocument();
    expect(lastBody().weight_kg).toBe(18);
  });

  it("невозможный вес не уходит в расчёт", async () => {
    renderHint();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Вес для расчёта, кг");
    await screen.findByRole("button", { name: /Мин\./ });
    await user.clear(field);
    await user.type(field, "0");
    expect(
      screen.getByText(doctorRu.prescription.energy.weightInvalid),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Мин\./ })).toBeNull();
    expect(lastBody().weight_kg).toBe(18);
  });

  it("ребёнку до года называет строку белка 1,5 г на кг", async () => {
    birthDate = new Date(Date.now() - 200 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    weight = { weight_kg: 7, occurred_at: "2026-11-01T09:00:00Z" };
    (api.POST as Mock).mockResolvedValue({
      data: {
        ...FIVE_YEARS_18_KG,
        kcal_min: 525,
        kcal_max: 595,
        kcal_per_kg_min: 75,
        kcal_per_kg_max: 85,
        protein_g: 10.5,
        protein_g_per_kg: 1.5,
        fluid_ml: 700,
      },
    });
    const onApply = renderHint();
    expect(
      await screen.findByText(/белок 1,5 г на кг.*10,5 г белка/),
    ).toBeInTheDocument();
    expect(lastBody().age_years).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: /Макс\./ }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ proteinG: 10.5, proteinPerKg: 1.5 }),
    );
  });
});
