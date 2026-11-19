import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import accessRu from "../../locales/ru/access.json";
import { AccessCodeSheet, botName, groupedCode } from "./AccessCodeSheet";
import type { AccessCodeCreated } from "./useAccessCodes";

i18n.addResourceBundle("ru", "access", accessRu, true, true);

const ISSUED = {
  code: "K7Q4M2PX",
  purpose: "family_member",
  expires_at: "2026-11-26T09:00:00Z",
  join_url: "https://app.example/join?code=K7Q4M2PX",
  deep_link: "https://t.me/clinic_keto_bot?start=K7Q4M2PX",
} as unknown as AccessCodeCreated;

describe("access code sheet (ADR-0092)", () => {
  it("reads the bot name from the deep link", () => {
    expect(botName(ISSUED.deep_link)).toBe("@clinic_keto_bot");
    expect(botName(null)).toBeNull();
    expect(botName("https://evil.example/t.me/x")).toBeNull();
  });

  it("groups the eight characters in two", () => {
    expect(groupedCode("K7Q4M2PX")).toBe("K7Q4 M2PX");
  });

  it("has the code, the Telegram steps, the warning and the Uzbek block", () => {
    const { container } = render(<AccessCodeSheet issued={ISSUED} />);

    expect(screen.getByText("K7Q4 M2PX")).toBeInTheDocument();
    expect(
      screen.getByText(/найдите бота @clinic_keto_bot/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Не показывайте код посторонним."),
    ).toBeInTheDocument();
    const uzbek = container.querySelector('[lang="uz"]');
    expect(uzbek).toHaveTextContent("Oʻzbekcha");
    expect(uzbek).toHaveTextContent("@clinic_keto_bot botini toping");
  });

  it("falls back to the web steps without a bot", () => {
    render(<AccessCodeSheet issued={{ ...ISSUED, deep_link: null }} />);

    expect(screen.getByText(/откройте ссылку ниже/)).toBeInTheDocument();
    expect(screen.queryByText(/найдите бота/)).toBeNull();
  });
});
