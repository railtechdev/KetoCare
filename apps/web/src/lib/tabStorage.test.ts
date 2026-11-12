import { afterEach, describe, expect, it, vi } from "vitest";

import { clearTabStorage } from "./tabStorage";

describe("очистка хранилища вкладки при выходе", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("стирает черновики и код доступа, чужие ключи не трогает", () => {
    sessionStorage.setItem("ketocare.calculator.draft:p1:new", "[]");
    sessionStorage.setItem("ketocare:access-code:p1:family_member", "{}");
    sessionStorage.setItem("other-app", "keep");

    clearTabStorage();

    expect(
      sessionStorage.getItem("ketocare.calculator.draft:p1:new"),
    ).toBeNull();
    expect(
      sessionStorage.getItem("ketocare:access-code:p1:family_member"),
    ).toBeNull();
    expect(sessionStorage.getItem("other-app")).toBe("keep");
  });

  it("без доступа к хранилищу не падает", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked");
    });
    sessionStorage.setItem("ketocare.calculator.draft:p1:new", "[]");
    expect(() => clearTabStorage()).not.toThrow();
  });
});
