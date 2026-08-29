// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  customRange,
  fromDateTimeLocalInput,
  parseDateInput,
  presetRange,
  toDateInput,
  toDateTimeLocalInput,
} from "./time";

/** Обратный разбор ISO в местное время — так проверяется, что смещение учтено. */
function localOf(iso: string): string {
  return toDateTimeLocalInput(new Date(iso));
}

describe("presetRange", () => {
  it("неделя — семь суток, считая сегодняшние", () => {
    const range = presetRange("week", new Date(2026, 7, 28, 15, 30));

    expect(localOf(range.from)).toBe("2026-08-22T00:00");
    expect(localOf(range.to)).toBe("2026-08-28T23:59");
  });

  it("месяц — тридцать суток, считая сегодняшние", () => {
    const range = presetRange("month", new Date(2026, 7, 28, 15, 30));

    expect(localOf(range.from)).toBe("2026-07-30T00:00");
    expect(localOf(range.to)).toBe("2026-08-28T23:59");
  });

  it("границы уходят на сервер со смещением", () => {
    const range = presetRange("week", new Date(2026, 7, 28));

    // Aware datetime обязателен: naive сервер отклоняет (раздел 5.3 ТЗ).
    expect(range.from).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
    expect(range.to).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
  });
});

describe("customRange", () => {
  it("берёт день начала целиком и день конца до конца суток", () => {
    const range = customRange("2026-03-01", "2026-03-05");

    expect(range).not.toBeNull();
    expect(localOf(range!.from)).toBe("2026-03-01T00:00");
    expect(localOf(range!.to)).toBe("2026-03-05T23:59");
  });

  it("один и тот же день — корректный период", () => {
    const range = customRange("2026-03-01", "2026-03-01");

    expect(range).not.toBeNull();
    expect(localOf(range!.to)).toBe("2026-03-01T23:59");
  });

  it("перепутанные границы и неполный ввод дают null", () => {
    expect(customRange("2026-03-05", "2026-03-01")).toBeNull();
    expect(customRange("", "2026-03-01")).toBeNull();
    expect(customRange("2026-03-01", "")).toBeNull();
  });
});

describe("parseDateInput", () => {
  it("отклоняет несуществующую дату вместо переполнения", () => {
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("2026-13-01")).toBeNull();
    expect(parseDateInput("01.03.2026")).toBeNull();
  });

  it("возвращает местную полночь", () => {
    expect(toDateInput(parseDateInput("2026-03-01")!)).toBe("2026-03-01");
  });
});

describe("fromDateTimeLocalInput", () => {
  it("трактует ввод как местное время", () => {
    const iso = fromDateTimeLocalInput("2026-03-01T07:45");

    expect(iso).not.toBeNull();
    expect(localOf(iso!)).toBe("2026-03-01T07:45");
  });

  it("отклоняет пустой и неполный ввод", () => {
    expect(fromDateTimeLocalInput("")).toBeNull();
    expect(fromDateTimeLocalInput("2026-03-01")).toBeNull();
    expect(fromDateTimeLocalInput("2026-03-01T25:00")).toBeNull();
  });
});
