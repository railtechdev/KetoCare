import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../lib/i18n";
import commonRu from "../locales/ru/common.json";
import { AppToaster } from "./AppToaster";

i18n.addResourceBundle("ru", "common", commonRu, true, true);

describe("область уведомлений кабинета", () => {
  it("подписана по-русски, а не «Notifications»", () => {
    render(<AppToaster />);

    const region = screen.getByRole("region", {
      name: new RegExp(`^${commonRu.app.notifications}`),
    });
    expect(region.getAttribute("aria-label")).not.toMatch(/Notifications/);
  });
});
