import { describe, expect, it } from "vitest";

import { chatAudienceRoles, chatReadersList, telHref } from "./chatAudience";

const ROLE: Record<string, string> = { doctor: "врач", dietitian: "диетолог" };
const roleLabel = (role: string) => ROLE[role] ?? role;

describe("chatReadersList", () => {
  it("перечисляет специалистов с ролью", () => {
    expect(
      chatReadersList(
        [
          { full_name: "Иванова Анна", role: "doctor" },
          { full_name: "Петров Борис", role: "dietitian" },
        ],
        roleLabel,
        "ru",
      ),
    ).toBe("Иванова Анна (врач) и Петров Борис (диетолог)");
  });

  it("без имён отдаёт null, а не пустой перечень", () => {
    // Пустой перечень дал бы «видят специалисты: .» — экран обязан перейти
    // на роли, и решает это null, а не пустая строка.
    expect(chatReadersList(undefined, roleLabel, "ru")).toBeNull();
    expect(chatReadersList([], roleLabel, "ru")).toBeNull();
  });
});

describe("chatAudienceRoles", () => {
  it("называет только те роли, что ведут ребёнка", () => {
    expect(chatAudienceRoles([{ full_name: "Иванова", role: "doctor" }])).toBe(
      "doctor",
    );
    expect(
      chatAudienceRoles([{ full_name: "Петров", role: "dietitian" }]),
    ).toBe("dietitian");
    expect(
      chatAudienceRoles([
        { full_name: "Иванова", role: "doctor" },
        { full_name: "Петров", role: "dietitian" },
      ]),
    ).toBe("both");
  });

  it("без списка называет обе роли, а не меньше, чем разрешает сервер", () => {
    expect(chatAudienceRoles(undefined)).toBe("both");
    expect(chatAudienceRoles([])).toBe("both");
  });
});

describe("telHref", () => {
  it("оставляет от номера цифры и ведущий плюс", () => {
    expect(telHref("+998 (71) 123-45-67")).toBe("tel:+998711234567");
  });

  it("без номера ссылки нет", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref("звоните")).toBeNull();
  });
});
