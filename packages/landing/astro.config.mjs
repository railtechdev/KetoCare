// @ts-check
import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";

// Единственный файл настроек проекта лежит в корне монорепозитория (CLAUDE.md),
// а `pnpm --filter` запускает astro в каталоге пакета — без явного корня
// переменные не читались бы вовсе.
const rootDir = fileURLToPath(new URL("../../", import.meta.url));

// Ровно две нужные переменные, а не весь файл: рядом лежат SECRET_KEY и токен
// бота, и им нечего делать в объекте конфигурации.
const env = loadEnv(process.env.NODE_ENV ?? "development", rootDir, [
  "LANDING_PORT",
  "API_PROXY_TARGET",
]);

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
    server: {
      port: Number(env.LANDING_PORT ?? 4321),
      // На сервере `/api/v1/leads` проксирует nginx
      // (infra/nginx/ketocare-landing.conf), и запрос формы остаётся
      // same-origin. В `astro dev` этого не делал никто: форма заявки локально
      // отвечала 404, то есть единственную публичную ручку записи нельзя было
      // проверить, не собрав лендинг и не подняв рядом nginx.
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET ?? "http://127.0.0.1:8001",
          changeOrigin: true,
        },
      },
    },
  },
});
