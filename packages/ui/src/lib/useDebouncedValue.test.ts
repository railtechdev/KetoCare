import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("отдаёт новое значение только после паузы", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "м" } },
    );

    rerender({ value: "мас" });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("м");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("мас");
  });

  it("набор подряд откладывает запрос до последнего символа", () => {
    // Иначе каждый символ уходил бы полнотекстовым запросом к базе.
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "" } },
    );

    for (const value of ["м", "ма", "мас"]) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(200);
      });
    }
    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("мас");
  });
});
