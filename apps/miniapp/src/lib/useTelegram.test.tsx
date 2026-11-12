import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TabVisibleContext, useBottomButtons } from "./useTelegram";

/** Форма с «Сохранить / Отмена»: свои кнопки — только когда родных нет. */
function Form({ onSave }: { onSave: () => void }) {
  const native = useBottomButtons({
    main: { text: "Сохранить", onClick: onSave },
    secondary: { text: "Отмена", onClick: () => undefined },
  });
  return native ? (
    <p>кнопки внизу Telegram</p>
  ) : (
    <button type="button">Сохранить</button>
  );
}

function telegram(version: string) {
  const listeners = new Set<() => void>();
  const button = () => ({
    setParams: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    showProgress: vi.fn(),
    hideProgress: vi.fn(),
    onClick: (handler: () => void) => void listeners.add(handler),
    offClick: (handler: () => void) => void listeners.delete(handler),
  });
  const app = {
    initData: "",
    isVersionAtLeast: (wanted: string) => {
      const [a = 0, b = 0] = version.split(".").map(Number);
      const [c = 0, d = 0] = wanted.split(".").map(Number);
      return a > c || (a === c && b >= d);
    },
    MainButton: button(),
    SecondaryButton: button(),
  };
  (window as { Telegram?: unknown }).Telegram = { WebApp: app };
  return app;
}

afterEach(() => {
  delete (window as { Telegram?: unknown }).Telegram;
});

describe("нижние кнопки формы (ADR-0075)", () => {
  it("вне Telegram форма рисует свои кнопки", () => {
    render(<Form onSave={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Сохранить" })).toBeVisible();
  });

  it("в старом клиенте (до 7.10) — тоже свои, родные не трогаются", () => {
    const app = telegram("7.7");
    render(<Form onSave={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Сохранить" })).toBeVisible();
    expect(app.MainButton.setParams).not.toHaveBeenCalled();
  });

  it("в клиенте 7.10+ — родные кнопки Telegram, своих на странице нет", () => {
    const app = telegram("8.0");
    const { unmount } = render(<Form onSave={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
    expect(app.MainButton.setParams).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Сохранить", is_visible: true }),
    );
    expect(app.SecondaryButton.setParams).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Отмена" }),
    );

    unmount();
    expect(app.MainButton.hide).toHaveBeenCalled();
  });

  it("форма на скрытой вкладке кнопки не занимает", () => {
    const app = telegram("8.0");
    render(
      <TabVisibleContext value={false}>
        <Form onSave={vi.fn()} />
      </TabVisibleContext>,
    );

    expect(app.MainButton.setParams).not.toHaveBeenCalled();
  });
});
