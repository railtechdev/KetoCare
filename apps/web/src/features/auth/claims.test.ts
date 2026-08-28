// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readTokenClaims } from "./claims";

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.signature`;
}

describe("readTokenClaims", () => {
  it("читает роль и идентификатор пользователя", () => {
    const token = makeToken({ sub: "u-1", role: "doctor", type: "access" });
    expect(readTokenClaims(token)).toEqual({
      userId: "u-1",
      role: "doctor",
      patientScope: null,
    });
  });

  it("читает ограничение по пациенту (токен Mini App)", () => {
    const token = makeToken({
      sub: "u-2",
      role: "parent",
      patient_scope: "p-9",
    });
    expect(readTokenClaims(token)?.patientScope).toBe("p-9");
  });

  it("отвергает неизвестную роль", () => {
    // Иначе подстановка произвольной строки в role показала бы пункты меню,
    // которых для этой роли не существует.
    expect(
      readTokenClaims(makeToken({ sub: "u-3", role: "superuser" })),
    ).toBeNull();
  });

  it("отвергает токен без subject", () => {
    expect(readTokenClaims(makeToken({ role: "parent" }))).toBeNull();
  });

  it("не падает на мусоре вместо токена", () => {
    expect(readTokenClaims("не-токен")).toBeNull();
    expect(readTokenClaims("a.b.c")).toBeNull();
    expect(readTokenClaims("")).toBeNull();
  });
});
