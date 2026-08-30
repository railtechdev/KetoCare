// @ts-check
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

/**
 * Домен нужен на сборке: из него собираются canonical, hreflang, og:url и
 * sitemap. Временный домен пред-прода задан значением по умолчанию, при
 * передаче клиенту меняется переменной окружения, а не правкой кода.
 */
const site = process.env.LANDING_SITE_URL ?? "https://ketocare.railtech.uz";

export default defineConfig({
  site,
  // Адрес кабинета: ссылки «Войти» ведут на другой поддомен, и он тоже
  // обязан меняться вместе с доменом (docs/DEPLOY.md).
  build: { format: "directory" },
  i18n: {
    locales: ["ru", "uz", "en"],
    defaultLocale: "ru",
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: "ru",
        locales: { ru: "ru", uz: "uz-Latn-UZ", en: "en" },
      },
    }),
  ],
  // Лендинг — статика: ни одного мегабайта фреймворка в браузер. Вся
  // интерактивность (калькулятор, демо-бот, формы) — обычные скрипты.
  vite: {
    build: { assetsInlineLimit: 0 },
  },
});
