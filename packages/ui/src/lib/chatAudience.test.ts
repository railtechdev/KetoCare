import { describe, expect, it } from "vitest";

import { chatReadersList } from "./chatAudience";

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
