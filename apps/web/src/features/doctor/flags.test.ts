import { describe, expect, it } from "vitest";

import { attentionRank, computePatientFlags, NO_DATA_FLAG_DAYS } from "./flags";
import type { PatientOverview } from "./types";

/**
 * Назначение в наборе по умолчанию: молчание семьи и вердикт о допуске имеют
 * смысл только у ребёнка, которому уже назначена терапия. Случай «назначения
 * нет» проверяется отдельно и явно.
 */
const PRESCRIPTION = {
  id: "rx1",
  patient_id: "p1",
  ratio: 3.5,
  kcal_per_day: 1200,
  protein_g: 12,
  carbs_limit_g: 35,
  meals_per_day: 4,
  starts_on: "2026-08-01",
  created_at: "2026-08-01T10:00:00Z",
} as unknown as NonNullable<PatientOverview["prescription"]>;

function overview(patch: Partial<PatientOverview> = {}): PatientOverview {
  return {
    patient_id: "p1",
    date: "2026-08-28",
    prescription: PRESCRIPTION,
    day: null,
    last_ketone: null,
    last_weight: null,
    seizures_today: { entries: 0, count: 0 },
    ...patch,
  };
}

const TOTALS = {
  kcal: 1200,
  fat: 100,
  protein: 30,
  carbs: 12,
  fiber: 4,
  ratio: 2.4,
};

describe("computePatientFlags", () => {
  it("без сводки флагов нет", () => {
    expect(computePatientFlags(null)).toBeNull();
  });

  it("не выдаёт неразобранную дату сводки за отсутствие замеров", () => {
    // Красное «Замеров ещё не было» — клиническое утверждение. Сказать его по
    // сбою разбора значит поднять наверх списка ребёнка, который меряется
    // дважды в день, и увести внимание врача от того, кто действительно молчит.
    const flags = computePatientFlags(
      overview({
        date: "не дата",
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-28T08:00:00+05:00",
        },
      }),
    );

    expect(flags).toBeNull();
  });

  it("считает сутки по календарю, а не по разнице часов", () => {
    const flags = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-27T22:30:00+05:00",
        },
      }),
    );

    expect(flags?.daysSinceLastReading).toBe(1);
    expect(flags?.staleData).toBe(false);
  });

  it("берёт самый свежий из замеров", () => {
    const flags = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-10T09:00:00+05:00",
        },
        last_weight: {
          weight_kg: 18.4,
          occurred_at: "2026-08-26T09:00:00+05:00",
        },
      }),
    );

    expect(flags?.daysSinceLastReading).toBe(2);
  });

  it("записи о приступах за сегодня снимают молчание", () => {
    const flags = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-07-01T09:00:00+05:00",
        },
        seizures_today: { entries: 1, count: 2 },
      }),
    );

    expect(flags?.daysSinceLastReading).toBe(0);
    expect(flags?.staleData).toBe(false);
  });

  it("помечает молчание ровно на пороге ТЗ", () => {
    const atThreshold = computePatientFlags(
      overview({
        last_weight: {
          weight_kg: 18.4,
          occurred_at: "2026-08-25T09:00:00+05:00",
        },
      }),
    );
    const beforeThreshold = computePatientFlags(
      overview({
        last_weight: {
          weight_kg: 18.4,
          occurred_at: "2026-08-26T09:00:00+05:00",
        },
      }),
    );

    expect(NO_DATA_FLAG_DAYS).toBe(3);
    expect(atThreshold?.daysSinceLastReading).toBe(3);
    expect(atThreshold?.staleData).toBe(true);
    expect(beforeThreshold?.staleData).toBe(false);
  });

  it("считает молчанием и полное отсутствие замеров", () => {
    const flags = computePatientFlags(overview());

    expect(flags?.daysSinceLastReading).toBeNull();
    expect(flags?.staleData).toBe(true);
  });

  it("помечает пациента без назначения — и не считает его молчащим", () => {
    // Ребёнок прикрепляется к врачу молча, в момент, когда семья его заводит.
    // Первое, что от врача требуется, — назначение; до него не с чем сверять
    // день. А «замеров нет трое суток» у такого пациента говорит не о семье, а
    // о том же самом: терапии ещё не назначено. Второй красный значок рядом
    // делит внимание и ничего не добавляет.
    const flags = computePatientFlags(overview({ prescription: null }));

    expect(flags?.noPrescription).toBe(true);
    expect(flags?.staleData).toBe(false);
  });

  it("ставит ожидание назначения выше молчания и отклонения вместе", () => {
    const waiting = computePatientFlags(overview({ prescription: null }));
    const worst = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: false,
            kcal_within_tolerance: false,
          },
          engine_version: "1.0.0",
        },
      }),
    );

    expect(worst?.staleData).toBe(true);
    expect(worst?.nutritionOff).toBe(true);
    expect(attentionRank(waiting)).toBeGreaterThan(attentionRank(worst));
  });

  it("отклонение питания берёт из вердикта сервера", () => {
    const off = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: false,
            kcal_within_tolerance: true,
          },
          engine_version: "1.0.0",
        },
      }),
    );
    const within = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: true,
          },
          engine_version: "1.0.0",
        },
      }),
    );

    expect(off?.nutritionOff).toBe(true);
    expect(within?.nutritionOff).toBe(false);
  });

  it("не поднимает флаг из-за одной калорийности недоспланированного дня", () => {
    // Сервер сравнивает набранное за день с СУТОЧНОЙ нормой, поэтому у любого
    // пациента, у кого спланирован не весь день, kcal_within_tolerance ложен.
    // Учитывать его во флаге значит зажечь флаг у всего списка сразу — и
    // столбец «Внимание» перестанет что-либо выделять.
    const flags = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: false,
          },
          engine_version: "1.0.0",
        },
      }),
    );

    expect(flags?.nutritionOff).toBe(false);
  });

  it("без вердикта сервера флага отклонения нет", () => {
    const flags = computePatientFlags(
      overview({ day: { totals: TOTALS, tolerance: null } }),
    );

    expect(flags?.nutritionOff).toBe(false);
  });
});

describe("attentionRank", () => {
  it("поднимает молчание выше отклонения питания", () => {
    expect(
      attentionRank({
        noPrescription: false,
        daysSinceLastReading: 5,
        staleData: true,
        nutritionOff: false,
      }),
    ).toBeGreaterThan(
      attentionRank({
        noPrescription: false,
        daysSinceLastReading: 0,
        staleData: false,
        nutritionOff: true,
      }),
    );
  });

  it("строка без сводки не поднимается наверх", () => {
    expect(attentionRank(null)).toBe(0);
  });
});
