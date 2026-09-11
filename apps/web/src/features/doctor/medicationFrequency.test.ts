// @vitest-environment node
import { describe, expect, it } from "vitest";

import doctorRu from "../../locales/ru/doctor.json";
import {
  MEDICATION_FREQUENCIES,
  describeFrequency,
  isMedicationFrequency,
} from "./medicationFrequency";

const label = (code: string) =>
  (doctorRu.medications.frequencyCodes as Record<string, string>)[code] ?? "";

describe("кратность приёма", () => {
  it("у каждого значения списка есть подпись, и лишних подписей нет", () => {
    // Словарь со своей стороны сверяет с сервером тест API
    // (`test_medication_frequency.py`): вместе они держат все три списка.
    expect(Object.keys(doctorRu.medications.frequencyCodes).sort()).toEqual(
      [...MEDICATION_FREQUENCIES].sort(),
    );
  });

  it("код с уточнением — подпись и слова через тире", () => {
    expect(
      describeFrequency(
        { frequency_code: "twice_daily", frequency: "утром и на ночь" },
        label,
      ),
    ).toBe("2 раза в сутки — утром и на ночь");
    expect(
      describeFrequency(
        { frequency_code: "once_daily", frequency: null },
        label,
      ),
    ).toBe("1 раз в сутки");
  });

  it("у «другой схемы» и у записи до списка — только слова", () => {
    expect(
      describeFrequency(
        { frequency_code: "other", frequency: "через два дня на третий" },
        label,
      ),
    ).toBe("через два дня на третий");
    expect(
      describeFrequency(
        { frequency_code: null, frequency: "2 раза в день" },
        label,
      ),
    ).toBe("2 раза в день");
  });

  it("чужое значение не выдаётся за код", () => {
    expect(isMedicationFrequency("twice_daily")).toBe(true);
    expect(isMedicationFrequency("BID")).toBe(false);
    expect(isMedicationFrequency("")).toBe(false);
  });
});
