import { afterEach, describe, expect, it, vi } from "vitest";

import { rememberTab, rememberedCloudTab, rememberedTab } from "./tabs";

afterEach(() => {
  globalThis.localStorage.clear();
  delete (window as { Telegram?: unknown }).Telegram;
});

describe("запомненная вкладка (ADR-0075)", () => {
  it("открывается та, что была открыта в прошлый раз", () => {
    expect(rememberedTab()).toBeNull();
    rememberTab("diary");
    expect(rememberedTab()).toBe("diary");
  });

  it("чужое значение в хранилище не открывает несуществующую вкладку", () => {
    globalThis.localStorage.setItem("ketocare.miniapp.tab", "calculator");
    expect(rememberedTab()).toBeNull();
  });

  it("недоступное хранилище не роняет приложение", () => {
    const get = vi
      .spyOn(globalThis.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const set = vi
      .spyOn(globalThis.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(rememberedTab()).toBeNull();
    expect(() => rememberTab("dishes")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it("в Telegram 6.9+ вкладка уходит и в облако — и читается оттуда", () => {
    const store = new Map<string, string>();
    (window as { Telegram?: unknown }).Telegram = {
      WebApp: {
        initData: "",
        isVersionAtLeast: () => true,
        CloudStorage: {
          setItem: (key: string, value: string) => void store.set(key, value),
          getItem: (
            key: string,
            callback: (error: string | null, value?: string) => void,
          ) => callback(null, store.get(key) ?? ""),
        },
      },
    };

    rememberTab("assistant");
    const onTab = vi.fn();
    rememberedCloudTab(onTab);

    expect(onTab).toHaveBeenCalledWith("assistant");
  });

  it("без облака Telegram вкладка из облака не приходит вовсе", () => {
    const onTab = vi.fn();
    rememberedCloudTab(onTab);
    expect(onTab).not.toHaveBeenCalled();
  });
});
