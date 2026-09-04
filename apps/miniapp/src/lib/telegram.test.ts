import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Определение «мы внутри Telegram» — единственная развилка, после которой
 * приложение либо работает, либо показывает тупик «откройте кнопкой в чате».
 *
 * Проверено на живом стенде: приложение, открытое КНОПКОЙ В ЧАТЕ, объявляло
 * себя открытым вне Telegram, потому что запасной источник строки запуска
 * опрашивался только при исключении SDK — а SDK умеет вернуть пустое значение
 * молча.
 */

const retrieve = vi.hoisted(() => vi.fn());

vi.mock("@telegram-apps/sdk-react", () => ({ retrieveRawInitData: retrieve }));

afterEach(() => {
  window.location.hash = "";
  retrieve.mockReset();
  delete (window as { Telegram?: unknown }).Telegram;
});

async function launchData() {
  const module = await import("./telegram");
  return module.launchData();
}

function telegramWith(initData: string) {
  (window as { Telegram?: unknown }).Telegram = { WebApp: { initData } };
}

function withAddress(hash: string) {
  window.location.hash = hash;
}

describe("строка запуска", () => {
  it("берётся из адреса, даже когда SDK молчит", async () => {
    // Замер на живом стенде: клиент передал параметры в хеше, а
    // `retrieveRawInitData` строки не отдал — ни исключением, ни значением.
    retrieve.mockReturnValue("");
    withAddress("#tgWebAppData=query_id%3Dfrom-hash&tgWebAppVersion=7.0");

    expect(await launchData()).toBe("query_id=from-hash");
  });

  it("адрес важнее прочих источников: подпись там свежая", async () => {
    retrieve.mockReturnValue("query_id=from-sdk");
    withAddress("#tgWebAppData=query_id%3Dfrom-hash");

    expect(await launchData()).toBe("query_id=from-hash");
  });

  it("берётся у SDK, когда он её нашёл", async () => {
    retrieve.mockReturnValue("query_id=from-sdk");

    expect(await launchData()).toBe("query_id=from-sdk");
  });

  it("берётся у клиента Telegram, когда SDK бросил исключение", async () => {
    retrieve.mockImplementation(() => {
      throw new Error("не из Telegram");
    });
    telegramWith("query_id=from-webapp");

    expect(await launchData()).toBe("query_id=from-webapp");
  });

  it("берётся у клиента Telegram и тогда, когда SDK вернул пустоту", async () => {
    // Тот самый случай со стенда: исключения нет, строки тоже нет — и до
    // правки запасной источник не опрашивался вовсе.
    retrieve.mockReturnValue("");
    telegramWith("query_id=from-webapp");

    expect(await launchData()).toBe("query_id=from-webapp");
  });

  it("вне Telegram остаётся пустой", async () => {
    retrieve.mockImplementation(() => {
      throw new Error("не из Telegram");
    });

    expect(await launchData()).toBeNull();
  });
});
