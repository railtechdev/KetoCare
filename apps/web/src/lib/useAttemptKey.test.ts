import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAttemptKey } from "./useAttemptKey";

/** Ключ, который примет сервер: видимые символы ASCII, до 255 (ADR-0035). */
const SERVER_ACCEPTS = /^[\x21-\x7e]{1,255}$/;

/** Среда без `crypto.randomUUID`: http в локальной сети, Safari до 15.4. */
function withoutRandomUUID<T>(body: () => T): T {
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
  });
  try {
    return body();
  } finally {
    Object.defineProperty(crypto, "randomUUID", {
      value: original,
      configurable: true,
    });
  }
}

describe("ключ попытки записи", () => {
  it("держится, пока записываемое не менялось", () => {
    // Повтор после потерянного ответа обязан прийти с тем же ключом, иначе
    // на сервере появится вторая такая же запись.
    const { result, rerender } = renderHook(
      ({ signature }) => useAttemptKey(signature),
      { initialProps: { signature: "омлет:50" } },
    );
    const first = result.current;

    rerender({ signature: "омлет:50" });

    expect(result.current).toBe(first);
    expect(first).toMatch(SERVER_ACCEPTS);
  });

  it("меняется, когда изменилось записываемое", () => {
    // Тот же ключ с другим телом сервер отвергает 422 — и правильно: это уже
    // не повтор, а новая запись.
    const { result, rerender } = renderHook(
      ({ signature }) => useAttemptKey(signature),
      { initialProps: { signature: "омлет:50" } },
    );
    const first = result.current;

    rerender({ signature: "омлет:60" });

    expect(result.current).not.toBe(first);
  });

  it("работает там, где нет crypto.randomUUID", () => {
    // По http в локальной сети и в Safari до 15.4 его нет вовсе, а вызов в
    // теле компонента уронил бы весь экран, а не одно сохранение.
    const key = withoutRandomUUID(
      () => renderHook(() => useAttemptKey("омлет:50")).result.current,
    );

    expect(key).toMatch(SERVER_ACCEPTS);
  });
});
