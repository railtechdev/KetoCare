import { describe, expect, it } from "vitest";

import { SECTIONS_BY_ROLE, navSectionsFor } from "../auth/roles";
import { ADMIN_SECTIONS } from "../admin/types";
import { SECTION_GROUPS } from "../../routes/sections";

/**
 * Who sees which articles (ADR-0093). The server decides; the menu only must
 * not offer a section that answers 403.
 */
describe("разделы статей по ролям", () => {
  it("клинические статьи — у врача и диетолога, и в меню", () => {
    for (const role of ["doctor", "dietitian"] as const) {
      expect(SECTIONS_BY_ROLE[role]).toContain("articles");
      expect(navSectionsFor(role)).toContain("articles");
      expect(SECTIONS_BY_ROLE[role]).not.toContain("productArticles");
    }
    expect(SECTION_GROUPS.articles).toBe("nutrition");
  });

  it("администратор клинических статей не видит нигде", () => {
    expect(SECTIONS_BY_ROLE.admin).not.toContain("articles");
    expect(SECTIONS_BY_ROLE.admin).toContain("productArticles");
    expect(navSectionsFor("admin")).toContain("productArticles");
    expect(ADMIN_SECTIONS).toContain("productArticles");
    expect(SECTION_GROUPS.productArticles).toBe("management");
  });

  it("семья не видит ни тех, ни других", () => {
    expect(SECTIONS_BY_ROLE.parent).not.toContain("articles");
    expect(SECTIONS_BY_ROLE.parent).not.toContain("productArticles");
  });
});
