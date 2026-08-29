// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ROLES, SECTIONS_BY_ROLE, isRole } from "./roles";

describe("роли", () => {
  it("распознаёт только известные роли", () => {
    expect(isRole("doctor")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("для каждой роли задан набор разделов", () => {
    for (const role of ROLES) {
      expect(SECTIONS_BY_ROLE[role].length).toBeGreaterThan(0);
    }
  });

  it("администратор не видит клинических разделов", () => {
    // Раздел 5.1 ТЗ: у админа нет доступа к клиническим данным. Сервер это и так
    // запрещает, но показывать пункт меню, ведущий к 403, тоже неправильно.
    const adminSections = SECTIONS_BY_ROLE.admin;
    for (const clinical of [
      "diary",
      "menu",
      "patients",
      "calculator",
      "reports",
    ]) {
      expect(adminSections).not.toContain(clinical);
    }
  });

  it("родитель не видит врачебных и админских разделов", () => {
    const parentSections = SECTIONS_BY_ROLE.parent;
    for (const restricted of ["users", "audit", "dictionaries", "summaries"]) {
      expect(parentSections).not.toContain(restricted);
    }
  });
});
