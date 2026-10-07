import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "../lib/i18n";
import { isChunkLoadError, reloadOnceForChunkError } from "./chunkReload";
import { RouteErrorPage } from "./RouteErrorPage";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const CHUNK = new TypeError(
  "Failed to fetch dynamically imported module: https://x/assets/Diary-abc.js",
);

describe("сбой загрузки части приложения", () => {
  it("узнаёт отказ загрузки модуля и не путает его с прочими", () => {
    expect(isChunkLoadError(CHUNK)).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties"))).toBe(false);
  });

  it("перезагружает страницу один раз, а не по кругу", () => {
    // После выката у файлов новые имена: одна перезагрузка их подхватит. Если
    // и она не помогла (нет сети), цикл перезагрузок съел бы вкладку.
    const storage = memoryStorage();
    const reload = vi.fn();

    expect(reloadOnceForChunkError(CHUNK, storage, reload, 1_000)).toBe(true);
    expect(reloadOnceForChunkError(CHUNK, storage, reload, 20_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // Через минуту — снова можно: это уже другой выкат.
    expect(reloadOnceForChunkError(CHUNK, storage, reload, 90_000)).toBe(true);
  });

  it("прочие ошибки страницу не перезагружают", () => {
    const reload = vi.fn();
    expect(
      reloadOnceForChunkError(new Error("boom"), memoryStorage(), reload),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("экран ошибки — по-русски и с выходом", () => {
    // Прежде: «Something went wrong! Failed to fetch dynamically imported
    // module» без единой ссылки.
    render(<RouteErrorPage error={new Error("boom")} reset={() => {}} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Раздел не открылся" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Обновить страницу" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "В кабинет" })).toHaveAttribute(
      "href",
      "/app",
    );
  });
});
