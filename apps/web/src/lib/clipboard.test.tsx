import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import "./i18n";
import { BackupCodesPanel } from "../features/auth/BackupCodesPanel";
import { copyText } from "./clipboard";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("copyText", () => {
  it("отвечает «да» только после подтверждения записи", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyText("abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("отказ браузера и отсутствие API — «нет», а не исключение", async () => {
    stubClipboard(() => Promise.reject(new Error("NotAllowedError")));
    await expect(copyText("abc")).resolves.toBe(false);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await expect(copyText("abc")).resolves.toBe(false);
  });
});

describe("резервные коды: копирование", () => {
  it("при отказе не говорит «Скопировано», а называет выход", async () => {
    // userEvent.setup() ставит свой буфер обмена — подмена идёт после него.
    const user = userEvent.setup();
    stubClipboard(() => Promise.reject(new Error("NotAllowedError")));
    render(
      <BackupCodesPanel
        codes={["1111-2222"]}
        onDone={() => {}}
        doneLabel="Готово"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Скопировать/ }));

    expect(
      await screen.findByText(/Не удалось скопировать/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Скопировано")).toBeNull();
  });
});
