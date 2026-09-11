// @vitest-environment node
import { describe, expect, it } from "vitest";

import { canRetry } from "./retryable";

describe("повтор после отказа", () => {
  it("предлагается при сбое: нет ответа, ошибка сервера, лимит частоты", () => {
    expect(canRetry(null)).toBe(true);
    expect(canRetry("internal")).toBe(true);
    expect(canRetry("rate_limited")).toBe(true);
  });

  it("не предлагается, когда тот же запрос откажут так же", () => {
    expect(canRetry("validation_error")).toBe(false);
    expect(canRetry("forbidden")).toBe(false);
    expect(canRetry("not_found")).toBe(false);
    expect(canRetry("infeasible_calculation")).toBe(false);
  });
});
