import { describe, expect, it } from "vitest";

import {
  macroSplitAdvice,
  macroSplitLimit,
  macroSplitParts,
} from "./macroSplit";

describe("macroSplitParts", () => {
  it("молчит, когда раскладка сошлась или цели нет", () => {
    expect(macroSplitParts(null)).toEqual([]);
    expect(macroSplitParts(undefined)).toEqual([]);
    expect(
      macroSplitParts({
        protein_delta_g: 0.4,
        net_carbs_delta_g: -0.3,
        within_tolerance: true,
      }),
    ).toEqual([]);
  });

  it("называет белок сверх цели и нехватку углеводов — случай диетолога", () => {
    expect(
      macroSplitParts({
        protein_delta_g: 3.5,
        net_carbs_delta_g: -3.5,
        within_tolerance: false,
      }),
    ).toEqual([
      { key: "proteinMore", grams: 3.5 },
      { key: "carbsLess", grams: 3.5 },
    ]);
  });

  it("называет обратный случай", () => {
    expect(
      macroSplitParts({
        protein_delta_g: -2,
        net_carbs_delta_g: 2.2,
        within_tolerance: false,
      }),
    ).toEqual([
      { key: "proteinLess", grams: 2 },
      { key: "carbsMore", grams: 2.2 },
    ]);
  });

  it("не называет расхождение, которое напечаталось бы нулём, и цель, которой нет", () => {
    expect(
      macroSplitParts({
        protein_delta_g: 0.04,
        net_carbs_delta_g: -1.6,
        within_tolerance: false,
      }),
    ).toEqual([{ key: "carbsLess", grams: 1.6 }]);
    expect(
      macroSplitParts({
        protein_delta_g: null,
        net_carbs_delta_g: 1.4,
        within_tolerance: false,
      }),
    ).toEqual([{ key: "carbsMore", grams: 1.4 }]);
  });
});

describe("macroSplitAdvice", () => {
  it("молчит, когда раскладка сошлась или цели нет", () => {
    expect(macroSplitAdvice(null)).toBeNull();
    expect(
      macroSplitAdvice({
        protein_delta_g: 3,
        net_carbs_delta_g: -3,
        within_tolerance: true,
      }),
    ).toBeNull();
  });

  it("советует углеводы, когда их не хватает", () => {
    expect(
      macroSplitAdvice({
        protein_delta_g: 3.5,
        net_carbs_delta_g: -3.5,
        within_tolerance: false,
      }),
    ).toBe("addCarbs");
  });

  it("советует белок, когда не хватает его", () => {
    expect(
      macroSplitAdvice({
        protein_delta_g: -2,
        net_carbs_delta_g: 2,
        within_tolerance: false,
      }),
    ).toBe("addProtein");
  });

  it("называет большую нехватку, когда не хватает обоих", () => {
    expect(
      macroSplitAdvice({
        protein_delta_g: -1.2,
        net_carbs_delta_g: -2,
        within_tolerance: false,
      }),
    ).toBe("addCarbs");
    expect(
      macroSplitAdvice({
        protein_delta_g: -2,
        net_carbs_delta_g: null,
        within_tolerance: false,
      }),
    ).toBe("addProtein");
  });

  it("не советует добавлять, когда обоих больше цели", () => {
    expect(
      macroSplitAdvice({
        protein_delta_g: 1.5,
        net_carbs_delta_g: 1.5,
        within_tolerance: false,
      }),
    ).toBeNull();
  });
});

describe("macroSplitLimit", () => {
  it("молчит, когда лимит цели не мешает", () => {
    expect(macroSplitLimit(null)).toBeNull();
    expect(
      macroSplitLimit({
        protein_delta_g: 0.1,
        net_carbs_delta_g: -0.1,
        within_tolerance: true,
      }),
    ).toBeNull();
    expect(
      macroSplitLimit({
        protein_delta_g: 0.1,
        net_carbs_delta_g: -0.1,
        carbs_limited_by_g: 0.02,
        within_tolerance: true,
      }),
    ).toBeNull();
  });

  it("называет, на сколько лимит снизил цель по углеводам", () => {
    expect(
      macroSplitLimit({
        protein_delta_g: 0,
        net_carbs_delta_g: -0.1,
        carbs_limited_by_g: 0.8,
        within_tolerance: true,
      }),
    ).toBe(0.8);
  });

  it("блюду у лимита не советуют добавить углеводов", () => {
    // Расхождения приходят уже от того, что помещается в лимит: у блюда,
    // упёршегося в него, нехватки нет, и совета нет.
    const fit = {
      protein_delta_g: 0.1,
      net_carbs_delta_g: -0.1,
      carbs_limited_by_g: 0.8,
      within_tolerance: true,
    };
    expect(macroSplitAdvice(fit)).toBeNull();
    expect(macroSplitParts(fit)).toEqual([]);
  });
});
