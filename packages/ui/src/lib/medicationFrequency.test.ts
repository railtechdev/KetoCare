// @vitest-environment node
import { describe, expect, it } from "vitest";

import { describeMedicationFrequency } from "./medicationFrequency";

const label = (code: string) => `[${code}]`;

describe("describeMedicationFrequency", () => {
  it("код и уточнение — через тире", () => {
    expect(
      describeMedicationFrequency(
        { frequency_code: "twice_daily", frequency: "утром и на ночь" },
        label,
      ),
    ).toBe("[twice_daily] — утром и на ночь");
  });

  it("код без уточнения — одна подпись", () => {
    expect(
      describeMedicationFrequency(
        { frequency_code: "once_daily", frequency: null },
        label,
      ),
    ).toBe("[once_daily]");
  });

  it("«другая схема» и запись до списка — только слова", () => {
    expect(
      describeMedicationFrequency(
        { frequency_code: "other", frequency: "титрование" },
        label,
      ),
    ).toBe("титрование");
    expect(
      describeMedicationFrequency(
        { frequency_code: null, frequency: "2 раза в день" },
        label,
      ),
    ).toBe("2 раза в день");
    expect(describeMedicationFrequency({}, label)).toBe("");
  });
});
