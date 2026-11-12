import { describe, expect, it } from "vitest";

import {
  LAUNCH_VALUES,
  launchTargetOf,
  launchValue,
  targetOf,
} from "./launchTarget";

/**
 * Договор с ботом (ADR-0075, `apps/miniapp/README.md`): кнопка под
 * напоминанием открывает приложение сразу на нужной форме. Значения и места,
 * где они лежат в адресе, — то, на что опирается бот; меняются они только
 * вместе с ним.
 */
const at = (search: string, hash = "") => ({ search, hash });

describe("параметр запуска", () => {
  it("читается из строки запроса", () => {
    expect(launchValue(at("?open=diary-ketones"), null)).toBe("diary-ketones");
  });

  it("читается из хеша рядом с подписью Telegram", () => {
    expect(
      launchValue(
        at(
          "",
          "#tgWebAppData=query_id%3D1%26hash%3Dx&open=menu&tgWebAppVersion=8.0",
        ),
        "query_id=1&hash=x",
      ),
    ).toBe("menu");
  });

  it("`open` важнее параметра прямой ссылки", () => {
    expect(
      launchValue(at("?open=diary", "#tgWebAppStartParam=settings"), null),
    ).toBe("diary");
  });

  it("параметр прямой ссылки `startapp` — из адреса и из строки запуска", () => {
    expect(launchValue(at("", "#tgWebAppStartParam=reminders"), null)).toBe(
      "reminders",
    );
    expect(launchValue(at(""), "query_id=1&start_param=family&hash=x")).toBe(
      "family",
    );
    expect(launchValue(at(""), null, "diary-weight")).toBe("diary-weight");
  });

  it("без параметра — `null`, и приложение открывает запомненную вкладку", () => {
    expect(launchValue(at("", "#tgWebAppData=x"), "x")).toBeNull();
    expect(launchTargetOf(at("?open="), null)).toBeNull();
  });
});

describe("куда ведёт значение", () => {
  it("каждое значение договора ведёт в своё место", () => {
    expect(targetOf("today")).toEqual({ tab: "today" });
    expect(targetOf("menu")).toEqual({ tab: "today", view: "menu" });
    expect(targetOf("diary")).toEqual({ tab: "diary" });
    expect(targetOf("diary-seizures")).toEqual({
      tab: "diary",
      addKind: "seizures",
    });
    expect(targetOf("diary-ketones")).toEqual({
      tab: "diary",
      addKind: "ketones",
    });
    expect(targetOf("diary-weight")).toEqual({
      tab: "diary",
      addKind: "weight",
    });
    expect(targetOf("diary-medications")).toEqual({
      tab: "diary",
      addKind: "medications",
    });
    expect(targetOf("diary-side-effects")).toEqual({
      tab: "diary",
      addKind: "side-effects",
    });
    expect(targetOf("settings")).toEqual({ settings: true });
    expect(targetOf("family")).toEqual({ settings: true, section: "family" });
    expect(targetOf("reminders")).toEqual({
      settings: true,
      section: "reminders",
    });
  });

  it("незнакомое значение — главная, а не ошибка: бот может быть новее", () => {
    expect(targetOf("diary-meals")).toEqual({ tab: "today" });
    expect(targetOf("<script>")).toEqual({ tab: "today" });
    expect(targetOf("")).toEqual({ tab: "today" });
  });

  it("ни одно значение договора не падает в главную по ошибке", () => {
    for (const value of LAUNCH_VALUES) {
      if (value === "today") continue;
      expect(targetOf(value)).not.toEqual({ tab: "today" });
    }
  });
});
