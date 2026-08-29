// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, readThemePreference, storeThemePreference } from "./theme";

/**
 * Хранилище подставляется явно: jsdom этой сборки `localStorage` не
 * предоставляет вовсе, и тест, полагающийся на окружение, проверял бы не тему,
 * а наличие хранилища. Заодно это позволяет смоделировать приватное окно, где
 * обращение к хранилищу бросает исключение.
 */
function stubStorage(options: { throws?: boolean } = {}) {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.throws) throw new Error("storage disabled");
      values.set(key, value);
    },
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
}

function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn() }),
  );
}

describe("тема оформления", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
    stubStorage();
  });

  it("по умолчанию следует системной настройке", () => {
    stubSystemDark(true);
    applyTheme(readThemePreference());
    expect(document.documentElement.dataset.theme).toBe("dark");

    stubSystemDark(false);
    applyTheme(readThemePreference());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("явный выбор перевешивает системную настройку", () => {
    stubSystemDark(false);
    storeThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    stubSystemDark(true);
    storeThemePreference("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("выбор переживает перезагрузку", () => {
    stubSystemDark(false);
    storeThemePreference("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("недоступное хранилище не ломает переключение", () => {
    // В приватном окне обращение к localStorage бросает исключение. Отказать в
    // переключении темы из-за этого нельзя — выбор просто не переживёт
    // перезагрузку.
    stubStorage({ throws: true });
    stubSystemDark(false);

    expect(() => storeThemePreference("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("отсутствие хранилища не мешает прочитать настройку", () => {
    vi.stubGlobal("localStorage", undefined);
    stubSystemDark(false);

    expect(readThemePreference()).toBe("system");
  });
});
