import { describe, expect, it } from "vitest";

import { medicationTerm, scheduledMedications } from "./medicationTerm";

const TODAY = "2026-11-20";

describe("medicationTerm", () => {
  it("четыре случая срока — те же, что печатает лист кабинета", () => {
    expect(medicationTerm({ started_at: "2026-10-01" }, TODAY)).toEqual({
      key: "ongoing",
    });
    expect(
      medicationTerm(
        { started_at: "2026-10-01", stopped_at: "2026-12-01" },
        TODAY,
      ),
    ).toEqual({ key: "until", date: "2026-12-01" });
    expect(
      medicationTerm({ started_at: "2026-11-25", stopped_at: null }, TODAY),
    ).toEqual({ key: "startsOn", date: "2026-11-25" });
    expect(
      medicationTerm(
        { started_at: "2026-11-25", stopped_at: "2026-12-25" },
        TODAY,
      ),
    ).toEqual({ key: "startsUntil", from: "2026-11-25", to: "2026-12-25" });
  });

  it("начатый сегодня — уже принимается", () => {
    expect(medicationTerm({ started_at: TODAY }, TODAY)).toEqual({
      key: "ongoing",
    });
  });
});

describe("scheduledMedications", () => {
  it("отменённые не попадают, остальные — по алфавиту", () => {
    const items = [
      { id: "a", drug_name: "Топирамат", started_at: "2026-01-01" },
      {
        id: "b",
        drug_name: "Вальпроат",
        started_at: "2026-01-01",
        stopped_at: "2026-11-19",
      },
      {
        id: "c",
        drug_name: "Леветирацетам",
        started_at: "2026-01-01",
        stopped_at: TODAY,
      },
      { id: "d", drug_name: "Клобазам", started_at: "2026-12-01" },
    ];

    expect(scheduledMedications(items, TODAY).map((item) => item.id)).toEqual([
      "d",
      "c",
      "a",
    ]);
  });
});
