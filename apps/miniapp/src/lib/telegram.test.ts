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

describe("язык клиента Telegram (ADR-0052)", () => {
  async function languageCode() {
    const module = await import("./telegram");
    return module.telegramLanguageCode();
  }

  it("берётся из пользователя в строке запуска", async () => {
    const user = encodeURIComponent(
      JSON.stringify({ id: 1, first_name: "Ona", language_code: "uz" }),
    );
    withAddress(`#tgWebAppData=${encodeURIComponent(`user=${user}&hash=x`)}`);

    expect(await languageCode()).toBe("uz");
  });

  it("пусто, когда клиент языка не прислал или строки нет", async () => {
    const user = encodeURIComponent(JSON.stringify({ id: 1 }));
    withAddress(`#tgWebAppData=${encodeURIComponent(`user=${user}&hash=x`)}`);
    expect(await languageCode()).toBeNull();

    withAddress("");
    retrieve.mockImplementation(() => {
      throw new Error("not in Telegram");
    });
    expect(await languageCode()).toBeNull();
  });
});

describe("кнопка «Назад», закрытие и ссылки Telegram", () => {
  function fakeApp() {
    const handlers = new Set<() => void>();
    const app = {
      initData: "",
      ready: vi.fn(),
      expand: vi.fn(),
      openLink: vi.fn(),
      enableClosingConfirmation: vi.fn(),
      disableClosingConfirmation: vi.fn(),
      disableVerticalSwipes: vi.fn(),
      enableVerticalSwipes: vi.fn(),
      BackButton: {
        show: vi.fn(),
        hide: vi.fn(),
        onClick: (handler: () => void) => void handlers.add(handler),
        offClick: (handler: () => void) => void handlers.delete(handler),
      },
    };
    (window as { Telegram?: unknown }).Telegram = { WebApp: app };
    const press = () => {
      for (const handler of handlers) handler();
    };
    return { app, press, handlers };
  }

  it("запуск — `ready` и `expand` одним вызовом", async () => {
    const { app } = fakeApp();
    const module = await import("./telegram");

    module.initTelegram();

    expect(app.ready).toHaveBeenCalled();
    expect(app.expand).toHaveBeenCalled();
  });

  it("«Назад» закрывает только верхнее вложенное состояние", async () => {
    // Подтверждение поверх панели: одно нажатие закрывало бы обе разом.
    const { app, press, handlers } = fakeApp();
    const module = await import("./telegram");
    const panel = vi.fn();
    const dialog = vi.fn();

    const closePanel = module.showBackButton(panel);
    const closeDialog = module.showBackButton(dialog);
    press();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(panel).not.toHaveBeenCalled();

    closeDialog();
    press();
    expect(panel).toHaveBeenCalledTimes(1);
    expect(app.BackButton.hide).not.toHaveBeenCalled();

    closePanel();
    expect(app.BackButton.hide).toHaveBeenCalled();
    expect(handlers.size).toBe(0);
  });

  it("незаконченный ввод: защита держится, пока жив последний", async () => {
    const { app } = fakeApp();
    const module = await import("./telegram");

    const first = module.guardUnsavedInput();
    const second = module.guardUnsavedInput();
    expect(app.enableClosingConfirmation).toHaveBeenCalledTimes(1);
    expect(app.disableVerticalSwipes).toHaveBeenCalledTimes(1);

    first();
    first();
    expect(app.disableClosingConfirmation).not.toHaveBeenCalled();
    second();
    expect(app.disableClosingConfirmation).toHaveBeenCalledTimes(1);
    expect(app.enableVerticalSwipes).toHaveBeenCalledTimes(1);
  });

  it("внешняя ссылка — через Telegram, а вне его — новой вкладкой", async () => {
    const { app } = fakeApp();
    const module = await import("./telegram");

    module.openExternalLink("https://ketocare.example");
    expect(app.openLink).toHaveBeenCalledWith("https://ketocare.example");

    delete (window as { Telegram?: unknown }).Telegram;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    module.openExternalLink("https://ketocare.example");
    expect(open).toHaveBeenCalledWith(
      "https://ketocare.example",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });
});
