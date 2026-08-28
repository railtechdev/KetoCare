import { describe, expect, it } from "vitest";

import {
  isRatioOnStep,
  prescriptionFormSchema,
  prescriptionFormValues,
  toPrescriptionBody,
  withVersions,
  type PrescriptionFormValues,
} from "./prescriptionSchema";
import type { Prescription } from "./types";

const VALID: PrescriptionFormValues = {
  ratio: 3.5,
  kcalPerDay: 1200,
  proteinG: 25,
  carbsLimitG: 10,
  mealsPerDay: 4,
  effectiveFrom: "2026-08-28",
  restrictions: "  ",
};

function prescription(patch: Partial<Prescription> = {}): Prescription {
  return {
    id: "rx-1",
    patient_id: "p1",
    ratio: 4,
    kcal_per_day: 1400,
    protein_g: 28,
    carbs_limit_g: 12,
    meals_per_day: 4,
    restrictions: null,
    author_id: "u1",
    effective_from: "2026-08-01",
    created_at: "2026-08-01T09:00:00Z",
    ...patch,
  };
}

describe("prescriptionFormSchema", () => {
  it("принимает значения в границах раздела 8.3 ТЗ", () => {
    expect(prescriptionFormSchema.safeParse(VALID).success).toBe(true);
  });

  it("держит кетосоотношение в границах 1.0-5.0", () => {
    for (const ratio of [0.5, 5.5]) {
      expect(
        prescriptionFormSchema.safeParse({ ...VALID, ratio }).success,
      ).toBe(false);
    }
  });

  it("требует шаг 0.5 для кетосоотношения", () => {
    expect(
      prescriptionFormSchema.safeParse({ ...VALID, ratio: 3.7 }).success,
    ).toBe(false);
    expect(
      prescriptionFormSchema.safeParse({ ...VALID, ratio: 4.5 }).success,
    ).toBe(true);
  });

  it("держит калорийность в границах 500-3000 и требует целое", () => {
    for (const kcalPerDay of [499, 3001, 1200.5]) {
      expect(
        prescriptionFormSchema.safeParse({ ...VALID, kcalPerDay }).success,
      ).toBe(false);
    }
  });

  it("отвергает несуществующую дату вступления в силу", () => {
    expect(
      prescriptionFormSchema.safeParse({
        ...VALID,
        effectiveFrom: "2026-02-31",
      }).success,
    ).toBe(false);
  });

  it("не проверяет выполнимость сочетания — это работа сервера", () => {
    // Цель по белку выше kcal/(9R+4) арифметически недостижима, и её отвергает
    // ядро на сервере. Форма такую проверку не дублирует.
    expect(
      prescriptionFormSchema.safeParse({ ...VALID, proteinG: 900 }).success,
    ).toBe(true);
  });
});

describe("isRatioOnStep", () => {
  it("не спотыкается о двоичное представление дробей", () => {
    expect(isRatioOnStep(2.5)).toBe(true);
    expect(isRatioOnStep(1.1)).toBe(false);
  });
});

describe("prescriptionFormValues", () => {
  it("переносит действующее назначение, но датирует версию сегодняшним днём", () => {
    const values = prescriptionFormValues(
      prescription({ restrictions: "без глютена" }),
      new Date(2026, 7, 28),
    );

    expect(values.ratio).toBe(4);
    expect(values.kcalPerDay).toBe(1400);
    expect(values.restrictions).toBe("без глютена");
    expect(values.effectiveFrom).toBe("2026-08-28");
  });

  it("для первого назначения числовые поля пусты", () => {
    const values = prescriptionFormValues(null, new Date(2026, 7, 28));

    expect(values.ratio).toBeUndefined();
    expect(values.kcalPerDay).toBeUndefined();
  });
});

describe("toPrescriptionBody", () => {
  it("пустые ограничения уходят как null, а не как пробелы", () => {
    expect(toPrescriptionBody(VALID).restrictions).toBeNull();
  });
});

describe("withVersions", () => {
  it("нумерует историю от старых к новым", () => {
    const items = [
      prescription({ id: "rx-3" }),
      prescription({ id: "rx-2" }),
      prescription({ id: "rx-1" }),
    ];

    expect(withVersions(items, 3).map((entry) => entry.version)).toEqual([
      3, 2, 1,
    ]);
  });

  it("на второй странице номера продолжают общий счёт", () => {
    expect(withVersions([prescription({ id: "rx-1" })], 5)[0]?.version).toBe(5);
  });
});
