import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import {
  MedicationScheduleSheet,
  scheduledMedications,
} from "./MedicationScheduleSheet";
import type { Medication } from "./types";

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

function med(overrides: Partial<Medication>): Medication {
  return {
    id: "m1",
    patient_id: "p1",
    drug_name: "Препарат А",
    dose: "250 мг",
    dose_value: 250,
    dose_unit: "mg",
    frequency_code: "twice_daily",
    frequency: "утром и на ночь",
    started_at: "2026-11-01",
    stopped_at: null,
    author_id: "u1",
    created_at: "2026-11-01T00:00:00Z",
    ...overrides,
  } as Medication;
}

describe("medication schedule sheet (ADR-0092)", () => {
  it("keeps what is taken today or starts later, by name", () => {
    const items = [
      med({ id: "b", drug_name: "Б" }),
      med({ id: "a", drug_name: "А" }),
      med({ id: "old", drug_name: "Отменён", stopped_at: "2026-11-10" }),
    ];

    expect(scheduledMedications(items, "2026-11-20").map((m) => m.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("gives a row of ticks per daily intake and prints the doctor's note", () => {
    const { container } = render(
      <MedicationScheduleSheet
        medications={[
          med({ id: "a" }),
          med({
            id: "b",
            drug_name: "Препарат Б",
            frequency_code: "once_daily",
            frequency: null,
          }),
        ]}
        today="2026-11-20"
      />,
    );

    expect(
      screen.getByText("2 раза в сутки — утром и на ночь"),
    ).toBeInTheDocument();
    const rows = container.querySelectorAll("tbody th[scope='row']");
    expect([...rows].map((row) => row.textContent)).toEqual([
      "Препарат А · приём 1",
      "Препарат А · приём 2",
      "Препарат Б",
    ]);
    expect(
      container.querySelectorAll("tbody td[aria-label='Отметка за Пн']"),
    ).toHaveLength(3);
    expect(screen.getByText("Не меняйте дозу сами.")).toBeInTheDocument();
  });

  it("says when a future drug starts", () => {
    render(
      <MedicationScheduleSheet
        medications={[med({ started_at: "2026-11-25" })]}
        today="2026-11-20"
      />,
    );

    expect(screen.getByText("с 25.11.2026")).toBeInTheDocument();
  });

  it("prints the last day of a drug the doctor is stopping", () => {
    // Без даты окончания лист с отменяемым препаратом читался как
    // «принимать дальше» (аудит документов 20.11.2026).
    render(
      <MedicationScheduleSheet
        medications={[
          med({ id: "a", stopped_at: "2026-11-25" }),
          med({
            id: "b",
            drug_name: "Второй",
            started_at: "2026-11-22",
            stopped_at: "2026-12-01",
          }),
        ]}
        today="2026-11-20"
      />,
    );

    expect(screen.getByText("до 25.11.2026 включительно")).toBeInTheDocument();
    expect(
      screen.getByText("с 22.11.2026 до 01.12.2026 включительно"),
    ).toBeInTheDocument();
  });

  it("does not tell the family what to do about a missed dose", () => {
    // Что делать при пропуске приёма — клиническое указание; его даёт врач,
    // а не лист (правило 1 CLAUDE.md).
    render(
      <MedicationScheduleSheet medications={[med({})]} today="2026-11-20" />,
    );

    expect(screen.queryByText(/[Пп]ропустили/)).toBeNull();
  });
});
