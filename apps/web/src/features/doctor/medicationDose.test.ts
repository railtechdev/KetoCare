// @vitest-environment node
import { describe, expect, it } from "vitest";

import doctorRu from "../../locales/ru/doctor.json";
import { MEDICATION_DOSE_UNITS, parseDoseValue } from "./medicationDose";

describe("единица дозы", () => {
  it("у каждой единицы списка есть подпись, и лишних подписей нет", () => {
    // Словарь со своей стороны сверяет с сервером тест API
    // (`test_medication_dose.py`): вместе они держат все три списка.
    expect(Object.keys(doctorRu.medications.doseUnits).sort()).toEqual(
      [...MEDICATION_DOSE_UNITS].sort(),
    );
  });
});

describe("число дозы из поля", () => {
  it("принимает запятую и точку, до трёх знаков", () => {
    expect(parseDoseValue("2,5")).toBe(2.5);
    expect(parseDoseValue(" 300 ")).toBe(300);
    expect(parseDoseValue("0.125")).toBe(0.125);
  });

  it("не принимает ноль, единицу в строке и лишнюю точность", () => {
    expect(parseDoseValue("0")).toBeNull();
    expect(parseDoseValue("300 мг")).toBeNull();
    expect(parseDoseValue("0,0001")).toBeNull();
    expect(parseDoseValue("")).toBeNull();
    expect(parseDoseValue("-5")).toBeNull();
    expect(parseDoseValue("100001")).toBeNull();
  });
});
