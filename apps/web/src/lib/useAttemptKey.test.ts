import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAttemptKey } from "./useAttemptKey";

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
});
