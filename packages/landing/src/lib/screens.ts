/**
 * Снимки экранов продукта, которые показывает сайт.
 *
 * Сняты с локального стенда на вымышленных данных (имена детей — «Амина К.»,
 * «Тимур Р.» и т. п.): кабинет — в окне 1440 × 900, приложение в Telegram — на
 * экране 390 × 844 с двойной плотностью. Подписи и описания для тех, кто
 * снимок не видит, — в словарях (`shots.*`), здесь только файлы и размеры:
 * размеры обязаны стоять в разметке, иначе страница прыгает, пока картинка
 * грузится.
 *
 * Кабинет в продукте только на русском, поэтому его снимки общие для всех
 * языков. Приложение в Telegram говорит и по-узбекски — у его снимков есть
 * узбекский вариант (`-uz`).
 */

import type { Locale } from "../i18n/config";

interface Screen {
  file: string;
  width: number;
  height: number;
  /** `cabinet` — окно браузера, `app` — экран телефона. */
  kind: "cabinet" | "app";
  /** Есть ли снимок узбекского интерфейса. */
  uz?: boolean;
}

export const SCREENS = {
  overview: {
    file: "cabinet-overview",
    width: 1440,
    height: 770,
    kind: "cabinet",
  },
  patients: {
    file: "cabinet-patients",
    width: 1440,
    height: 830,
    kind: "cabinet",
  },
  prescription: {
    file: "cabinet-prescription",
    width: 1440,
    height: 900,
    kind: "cabinet",
  },
  menu: { file: "cabinet-menu", width: 1440, height: 810, kind: "cabinet" },
  ketones: {
    file: "cabinet-ketones",
    width: 1440,
    height: 700,
    kind: "cabinet",
  },
  seizures: {
    file: "cabinet-seizures",
    width: 1440,
    height: 900,
    kind: "cabinet",
  },
  growth: { file: "cabinet-growth", width: 1440, height: 900, kind: "cabinet" },
  appHome: {
    file: "app-home",
    width: 560,
    height: 1212,
    kind: "app",
    uz: true,
  },
  appMenu: {
    file: "app-menu",
    width: 560,
    height: 1212,
    kind: "app",
    uz: true,
  },
  appDiary: {
    file: "app-diary",
    width: 560,
    height: 1212,
    kind: "app",
    uz: true,
  },
} satisfies Record<string, Screen>;

export type ScreenId = keyof typeof SCREENS;

/** Адрес файла снимка на нужном языке. */
export function screenSrc(id: ScreenId, locale: Locale): string {
  const screen: Screen = SCREENS[id];
  const suffix = screen.uz && locale === "uz" ? "-uz" : "";
  return `/screens/${screen.file}${suffix}.webp`;
}
