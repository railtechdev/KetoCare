// @vitest-environment node
import { createInstance, type TFunction } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import homeRu from "../../locales/ru/home.json";

/**
 * Словарь главной проверяется отдельным экземпляром i18next: пространство имён
 * подключается в общем `lib/i18n.ts`, а формы множественного числа выбирает сам
 * i18next по `Intl.PluralRules` — суффиксы ключей (`_one`/`_few`/`_many`) легко
 * задать неверно, и ошибка вылезет только на живом экране.
 */
let t: TFunction;

beforeAll(async () => {
  const instance = createInstance();
  await instance.init({
    lng: "ru",
    fallbackLng: "ru",
    resources: { ru: { home: homeRu } },
    interpolation: { escapeValue: false },
  });
  t = instance.getFixedT("ru", "home");
});

describe("словарь главной", () => {
  it("склоняет число приступов", () => {
    expect(t("seizures.unit", { count: 0 })).toBe("приступов");
    expect(t("seizures.unit", { count: 1 })).toBe("приступ");
    expect(t("seizures.unit", { count: 2 })).toBe("приступа");
    expect(t("seizures.unit", { count: 5 })).toBe("приступов");
  });

  it("склоняет число записей дневника", () => {
    expect(t("seizures.entries", { count: 0 })).toBe("0 записей в дневнике");
    expect(t("seizures.entries", { count: 1 })).toBe("1 запись в дневнике");
    expect(t("seizures.entries", { count: 3 })).toBe("3 записи в дневнике");
  });

  it("подставляет способ замера кетонов", () => {
    expect(t("ketone.method.blood")).toBe("Замер по крови");
    expect(t("ketone.method.urine")).toBe("Замер по моче");
  });

  it("показывает калорийность дня рядом с назначенной", () => {
    expect(t("day.kcalOfTarget", { value: "1420", target: "1500" })).toBe(
      "1420 из 1500 ккал",
    );
  });
});
