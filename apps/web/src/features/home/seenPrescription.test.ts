// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isNewPrescription, NEW_PRESCRIPTION_DAYS } from "./seenPrescription";

const NOW = new Date("2026-08-31T09:00:00Z");
const ID = "rx-1";

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("новость о назначении", () => {
  it("показывается, пока её не прочитали", () => {
    expect(isNewPrescription(daysAgo(1), null, ID, NOW)).toBe(true);
    expect(isNewPrescription(daysAgo(1), ID, ID, NOW)).toBe(false);
  });

  it("не выдаёт старое назначение за новость", () => {
    // У семей, которые ведут ребёнка не первый месяц, отметки «прочитано» нет
    // ни одной: без ограничения по сроку все они разом увидели бы «врач задал
    // назначение» о назначении полугодовой давности.
    expect(
      isNewPrescription(daysAgo(NEW_PRESCRIPTION_DAYS), null, ID, NOW),
    ).toBe(true);
    expect(
      isNewPrescription(daysAgo(NEW_PRESCRIPTION_DAYS + 1), null, ID, NOW),
    ).toBe(false);
  });

  it("прочитанным считается конкретное назначение, а не факт чтения", () => {
    // Назначения append-only: следующее — новая строка с новым id. Отметка о
    // прошлом не должна прятать новое, иначе правка назначения молча пройдёт
    // мимо семьи — а по нему она кормит ребёнка в тот же день.
    expect(isNewPrescription(daysAgo(1), "rx-0", ID, NOW)).toBe(true);
  });

  it("не спотыкается о неразобранную дату", () => {
    expect(isNewPrescription("не дата", null, ID, NOW)).toBe(false);
  });
});
