import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useKeyboardState } from "./keyboard";

const original = window.matchMedia;

function pointer(kind: "coarse" | "fine") {
  window.matchMedia = (query: string) =>
    ({ matches: query === `(pointer: ${kind})` }) as MediaQueryList;
}

afterEach(() => {
  window.matchMedia = original;
});

describe("useKeyboardState", () => {
  it("фокус поля на сенсорном экране — клавиатура открыта, потеря фокуса — закрыта", () => {
    pointer("coarse");
    const { result } = renderHook(() => useKeyboardState());

    act(() => result.current.report(true));
    expect(result.current.open).toBe(true);

    act(() => result.current.report(false));
    expect(result.current.open).toBe(false);
  });

  it("с мышью экранной клавиатуры нет", () => {
    pointer("fine");
    const { result } = renderHook(() => useKeyboardState());

    act(() => result.current.report(true));
    expect(result.current.open).toBe(false);
  });

  it("без matchMedia считается, что клавиатуры нет", () => {
    // @ts-expect-error — среда без matchMedia (старый WebView, тесты)
    window.matchMedia = undefined;
    const { result } = renderHook(() => useKeyboardState());

    act(() => result.current.report(true));
    expect(result.current.open).toBe(false);
  });
});

describe("клавиатура закрылась, а поле осталось в фокусе", () => {
  // Android: системная «Назад» и `hideKeyboard()` Telegram прячут клавиатуру,
  // не снимая фокус. Полоса вкладок оставалась скрытой без клавиатуры.
  const height = window.innerHeight;

  function resize(to: number) {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: to,
    });
    window.dispatchEvent(new Event("resize"));
  }

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: height,
    });
  });

  it("окно выросло обратно — клавиатура закрыта, фокус с поля снят", () => {
    pointer("coarse");
    resize(844);
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    const { result } = renderHook(() => useKeyboardState());

    act(() => result.current.report(true));
    act(() => resize(480));
    expect(result.current.open).toBe(true);

    act(() => resize(844));
    expect(result.current.open).toBe(false);
    expect(document.activeElement).not.toBe(field);
    field.remove();
  });

  it("без сжатия окна рост ничего не закрывает", () => {
    // Где клавиатура окно не сжимает, сигнал остаётся один — фокус; поворот
    // и мелкие изменения высоты полосы Telegram клавиатурой не считаются.
    pointer("coarse");
    resize(844);
    const { result } = renderHook(() => useKeyboardState());

    act(() => result.current.report(true));
    act(() => resize(800));
    act(() => resize(844));
    expect(result.current.open).toBe(true);
  });
});
