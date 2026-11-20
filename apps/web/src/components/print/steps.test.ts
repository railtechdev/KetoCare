import { describe, expect, it } from "vitest";

import { cookingSteps, numberedSteps } from "./steps";

describe("cooking steps on paper", () => {
  it("drops the dietitian's own numbering so the sheet does not print «1. 1.»", () => {
    expect(
      cookingSteps(
        "1. Взбить яйцо.\n2) Добавить брокколи.\n- Жарить 5 минут.\n",
      ),
    ).toEqual(["Взбить яйцо.", "Добавить брокколи.", "Жарить 5 минут."]);
  });

  it("keeps a number that is part of the step", () => {
    expect(
      cookingSteps("2 яйца взбить.\n1,5 часа варить.\n1.5 ч томить."),
    ).toEqual(["2 яйца взбить.", "1,5 часа варить.", "1.5 ч томить."]);
  });

  it("numbers several steps and leaves a single one as a sentence", () => {
    expect(numberedSteps("Взбить.\nЗапечь.")).toBe("1. Взбить.\n2. Запечь.");
    expect(numberedSteps("1. Взбить и запечь.")).toBe("Взбить и запечь.");
    expect(numberedSteps("  \n")).toBe("");
  });
});
