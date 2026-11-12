import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Определение «мы внутри Telegram» — единственная развилка, после которой
 * приложение либо работает, либо показывает тупик «откройте кнопкой в чате».
 *
 * Проверено на живом стенде: приложение, открытое КНОПКОЙ В ЧАТЕ, объявляло
 * себя открытым вне Telegram, потому что библиотека, через которую тогда
 * читалась строка запуска, умела вернуть пустоту молча. Библиотека убрана
 * (ADR-0075): адрес и `WebApp.initData` отвечают на тот же вопрос.
 */

afterEach(() => {
  window.location.hash = "";
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
  it("берётся из адреса", async () => {
    withAddress("#tgWebAppData=query_id%3Dfrom-hash&tgWebAppVersion=7.0");

    expect(await launchData()).toBe("query_id=from-hash");
  });

  it("адрес важнее клиента: подпись там свежая", async () => {
    telegramWith("query_id=from-webapp");
    withAddress("#tgWebAppData=query_id%3Dfrom-hash");

    expect(await launchData()).toBe("query_id=from-hash");
  });

  it("берётся у клиента Telegram, когда в адресе её нет", async () => {
    telegramWith("query_id=from-webapp");

    expect(await launchData()).toBe("query_id=from-webapp");
  });

  it("вне Telegram остаётся пустой", async () => {
    expect(await launchData()).toBeNull();
    telegramWith("");
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

describe("возможности новее Bot API 6.0 (ADR-0075)", () => {
  /** Клиент заданной версии с кнопками, вибрацией и пунктом «Настройки». */
  function client(version: string) {
    const listeners = {
      main: new Set<() => void>(),
      secondary: new Set<() => void>(),
    };
    const button = (set: Set<() => void>) => ({
      setParams: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      showProgress: vi.fn(),
      hideProgress: vi.fn(),
      onClick: (handler: () => void) => void set.add(handler),
      offClick: (handler: () => void) => void set.delete(handler),
    });
    const at = (v: string) => v.split(".").map(Number);
    const app = {
      initData: "query_id=1",
      version,
      isVersionAtLeast: (wanted: string) => {
        const [a = 0, b = 0] = at(version);
        const [c = 0, d = 0] = at(wanted);
        return a > c || (a === c && b >= d);
      },
      MainButton: button(listeners.main),
      SecondaryButton: button(listeners.secondary),
      HapticFeedback: {
        impactOccurred: vi.fn(),
        notificationOccurred: vi.fn(),
        selectionChanged: vi.fn(),
      },
      SettingsButton: {
        show: vi.fn(),
        hide: vi.fn(),
        onClick: vi.fn(),
        offClick: vi.fn(),
      },
      hideKeyboard: vi.fn(),
      setHeaderColor: vi.fn(),
      setBackgroundColor: vi.fn(),
      setBottomBarColor: vi.fn(),
      close: vi.fn(),
    };
    (window as { Telegram?: unknown }).Telegram = { WebApp: app };
    return {
      app,
      pressMain: () => {
        for (const handler of listeners.main) handler();
      },
      pressSecondary: () => {
        for (const handler of listeners.secondary) handler();
      },
    };
  }

  it("вне Telegram вибрация, клавиатура и кнопки молчат, ничего не роняя", async () => {
    const module = await import("./telegram");

    expect(() => {
      module.haptic("success");
      module.haptic("error");
    }).not.toThrow();
    expect(module.nativeBottomButtons()).toBe(false);
    expect(module.isVersionAtLeast("6.0")).toBe(false);
    expect(module.canCloseApp()).toBe(false);
    expect(module.showSettingsButton(vi.fn())).toBeTypeOf("function");
  });

  it("клиент старше 6.1 вибрацией не зовётся", async () => {
    const { app } = client("6.0");
    const module = await import("./telegram");

    module.haptic("success");

    expect(app.HapticFeedback.notificationOccurred).not.toHaveBeenCalled();
  });

  it("клиент 6.1+ вибрирует на отметке и отказе", async () => {
    const { app } = client("7.0");
    const module = await import("./telegram");

    module.haptic("success");
    module.haptic("error");

    expect(app.HapticFeedback.notificationOccurred).toHaveBeenNthCalledWith(
      1,
      "success",
    );
    expect(app.HapticFeedback.notificationOccurred).toHaveBeenNthCalledWith(
      2,
      "error",
    );
  });

  it("до 7.10 нижних кнопок Telegram нет — форма рисует свои", async () => {
    client("7.7");
    const module = await import("./telegram");

    expect(module.nativeBottomButtons()).toBe(false);
  });

  it("нижние кнопки принадлежат верхней форме и возвращаются нижней", async () => {
    const { app, pressMain, pressSecondary } = client("8.0");
    const module = await import("./telegram");
    const settingsSave = vi.fn();
    const entrySave = vi.fn();
    const entryCancel = vi.fn();

    expect(module.nativeBottomButtons()).toBe(true);
    const releaseSettings = module.pushBottomButtons(() => ({
      main: { text: "Сохранить напоминания", onClick: settingsSave },
    }));
    expect(app.SecondaryButton.hide).toHaveBeenCalled();
    const releaseEntry = module.pushBottomButtons(() => ({
      main: { text: "Сохранить", onClick: entrySave },
      secondary: { text: "Отмена", onClick: entryCancel },
    }));

    pressMain();
    pressSecondary();
    expect(entrySave).toHaveBeenCalledTimes(1);
    expect(entryCancel).toHaveBeenCalledTimes(1);
    expect(settingsSave).not.toHaveBeenCalled();
    expect(app.MainButton.setParams).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Сохранить", is_visible: true }),
    );

    releaseEntry();
    pressMain();
    expect(settingsSave).toHaveBeenCalledTimes(1);

    releaseSettings();
    expect(app.MainButton.hide).toHaveBeenCalled();
  });

  it("недоступная или занятая кнопка нажатия не передаёт", async () => {
    const { app, pressMain } = client("8.0");
    const module = await import("./telegram");
    const save = vi.fn();

    const release = module.pushBottomButtons(() => ({
      main: { text: "Сохранить", onClick: save, progress: true },
    }));
    pressMain();

    expect(save).not.toHaveBeenCalled();
    expect(app.MainButton.showProgress).toHaveBeenCalled();
    release();
  });

  it("клавиатура прячется методом 9.1, а в старом клиенте — снятием фокуса", async () => {
    const { app } = client("9.1");
    const module = await import("./telegram");
    module.hideKeyboard();
    expect(app.hideKeyboard).toHaveBeenCalled();

    client("8.0");
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    module.hideKeyboard();
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it("шапка и фон — в цвет приложения, нижняя полоса — с 7.10", async () => {
    const { app } = client("7.0");
    const module = await import("./telegram");

    module.applyChromeColors({ background: "#ffffff", bar: "#f4f4f5" });

    expect(app.setHeaderColor).toHaveBeenCalledWith("#ffffff");
    expect(app.setBackgroundColor).toHaveBeenCalledWith("#ffffff");
    expect(app.setBottomBarColor).not.toHaveBeenCalled();
  });

  it("пункт «Настройки» в меню Telegram — с 7.0", async () => {
    const { app } = client("7.0");
    const module = await import("./telegram");
    const open = vi.fn();

    const hide = module.showSettingsButton(open);
    expect(app.SettingsButton.show).toHaveBeenCalled();
    expect(app.SettingsButton.onClick).toHaveBeenCalledWith(open);
    hide();
    expect(app.SettingsButton.hide).toHaveBeenCalled();
  });
});
