import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { useFrozenAttempt } from "./useFrozenAttempt";

describe("попытка записи с неизвестной частью", () => {
  it("до отправки берёт свежайшее значение", () => {
    // Разговор мог прийти, пока человек набирал вопрос: слать пустой при
    // живом значило бы завести вторую переписку (ADR-0022).
    const { result, rerender } = renderHook(
      ({ current }) => useFrozenAttempt("вопрос", current),
      { initialProps: { current: null as string | null } },
    );

    rerender({ current: "c-1" });

    expect(result.current.value).toBe("c-1");
  });

  it("с первой отправки держит то, что ушло", () => {
    // Повтор после потерянного ответа обязан уйти с тем же телом и ключом,
    // иначе на сервере появится вторая запись (ADR-0035).
    const { result, rerender } = renderHook(
      ({ current }) => useFrozenAttempt("вопрос", current),
      { initialProps: { current: null as string | null } },
    );
    const key = result.current.key;

    act(() => {
      result.current.freeze();
    });
    rerender({ current: "c-1" });

    expect(result.current.value).toBeNull();
    expect(result.current.key).toBe(key);
  });

  it("смена записываемого начинает попытку заново", () => {
    const { result, rerender } = renderHook(
      ({ signature, current }) => useFrozenAttempt(signature, current),
      { initialProps: { signature: "вопрос", current: null as string | null } },
    );
    const key = result.current.key;
    act(() => {
      result.current.freeze();
    });

    rerender({ signature: "другой вопрос", current: "c-1" });

    expect(result.current.value).toBe("c-1");
    expect(result.current.key).not.toBe(key);
  });
});
