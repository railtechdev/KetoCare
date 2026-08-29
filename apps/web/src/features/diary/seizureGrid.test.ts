import { describe, expect, it } from "vitest";

import type { DiaryLog } from "./diaryApi";
import { buildSeizureGrid, formatCell } from "./seizureGrid";

const TYPES = [
  { id: "t-absence", name: "Абсанс", code: "A" },
  { id: "t-tc", name: "Тонико-клонический", code: "TC" },
  { id: "t-atonic", name: "Атонический", code: null },
];

function seizure(occurredAt: string, typeId: string, count = 1): DiaryLog {
  return {
    kind: "seizures",
    id: `log-${occurredAt}-${typeId}-${count}`,
    patient_id: "p1",
    occurred_at: occurredAt,
    seizure_type_id: typeId,
    duration_sec: null,
    count,
    description: null,
    triggers: null,
    source: "web",
    created_by: "u1",
    created_at: occurredAt,
    updated_at: occurredAt,
  } as unknown as DiaryLog;
}

describe("buildSeizureGrid", () => {
  it("раскладывает приступы по четырём частям суток", () => {
    // Границы — из дневника KETO-STEP: 06-12, 12-18, 18-00, 00-06.
    const grid = buildSeizureGrid(
      [
        seizure("2026-08-10T07:00:00", "t-absence"),
        seizure("2026-08-10T13:00:00", "t-absence"),
        seizure("2026-08-10T21:00:00", "t-absence"),
        seizure("2026-08-10T03:00:00", "t-absence"),
      ],
      TYPES,
    );

    const day = grid.rows[0]!;
    expect(day.cells.morning.total).toBe(1);
    expect(day.cells.afternoon.total).toBe(1);
    expect(day.cells.evening.total).toBe(1);
    expect(day.cells.night.total).toBe(1);
    expect(day.total).toBe(4);
  });

  it("считает приступы, а не записи", () => {
    // Одна запись дневника может описывать серию: подмена приступов записями
    // занижала бы клиническую картину.
    const grid = buildSeizureGrid(
      [seizure("2026-08-10T07:00:00", "t-absence", 5)],
      TYPES,
    );

    expect(grid.total).toBe(5);
    expect(formatCell(grid.rows[0]!.cells.morning)).toBe("5A");
  });

  it("складывает одинаковые типы в одной клетке и разделяет разные", () => {
    const grid = buildSeizureGrid(
      [
        seizure("2026-08-10T07:00:00", "t-absence", 2),
        seizure("2026-08-10T08:00:00", "t-absence", 3),
        seizure("2026-08-10T09:00:00", "t-tc"),
      ],
      TYPES,
    );

    expect(formatCell(grid.rows[0]!.cells.morning)).toBe("5A 1TC");
  });

  it("тип без кода подписывается названием, а не пропадает", () => {
    // Коды проставлены не всем типам (вопрос 4 медкоманде), и молча терять
    // такие приступы в сетке нельзя.
    const grid = buildSeizureGrid(
      [seizure("2026-08-10T07:00:00", "t-atonic")],
      TYPES,
    );

    expect(formatCell(grid.rows[0]!.cells.morning)).toBe("1Атонический");
  });

  it("дни без приступов в сетку не попадают", () => {
    const grid = buildSeizureGrid(
      [
        seizure("2026-08-10T07:00:00", "t-absence"),
        seizure("2026-08-14T07:00:00", "t-absence"),
      ],
      TYPES,
    );

    expect(grid.rows.map((row) => row.date)).toEqual([
      "2026-08-10",
      "2026-08-14",
    ]);
  });

  it("строки идут по возрастанию даты", () => {
    const grid = buildSeizureGrid(
      [
        seizure("2026-08-14T07:00:00", "t-absence"),
        seizure("2026-08-02T07:00:00", "t-absence"),
        seizure("2026-08-09T07:00:00", "t-absence"),
      ],
      TYPES,
    );

    expect(grid.rows.map((row) => row.date)).toEqual([
      "2026-08-02",
      "2026-08-09",
      "2026-08-14",
    ]);
  });

  it("записи других видов дневника в сетку не попадают", () => {
    const ketone = {
      kind: "ketones",
      id: "k1",
      occurred_at: "2026-08-10T07:00:00",
      value: 3.2,
    } as unknown as DiaryLog;

    expect(buildSeizureGrid([ketone], TYPES).rows).toEqual([]);
  });

  it("пустая клетка форматируется пустой строкой", () => {
    expect(formatCell({ byType: [], total: 0 })).toBe("");
  });
});
