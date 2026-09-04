import { defineConfig, devices } from "@playwright/test";

import { API_PORT, API_URL, ROOT, WEB_URL } from "./src/env";

/**
 * Сквозные тесты кабинета (раздел 13 ТЗ, раздел 15 п. 22).
 *
 * Поднимаются два процесса: API и дев-сервер кабинета. Postgres и Redis —
 * снаружи (`make dev` локально, сервисы job'а в CI): база живёт дольше прогона,
 * и поднимать её из конфигурации теста значило бы прятать состояние, от
 * которого зависит результат.
 *
 * Один браузер. Кабинет — не сайт: он открывается в рабочем окне специалиста и
 * на телефоне родителя, но проверять кросс-браузерность сквозным сценарием
 * дорого и бесполезно — расхождения ловятся вёрсткой, а не поведением.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  // Сценарий пишет в общую базу: назначение, меню и дневник у одного ребёнка.
  // Параллельные воркеры мешали бы друг другу, и падение читалось бы как
  // ошибка приложения.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: WEB_URL,
    locale: "ru-RU",
    timezoneId: "Asia/Tashkent",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // `--no-proxy-headers` — как в `make api`: без него uvicorn перепишет
      // адрес клиента из X-Forwarded-For, и ключ ограничения частоты станет
      // управляемым клиентом. В тесте это не вредит, но команда должна
      // совпадать с боевой, иначе она однажды разойдётся с ней молча.
      command: `uv run uvicorn api.main:app --app-dir apps/api/src --no-proxy-headers --port ${API_PORT}`,
      url: `${API_URL}/health`,
      cwd: ROOT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // `--strictPort`: занятый порт должен быть отказом, а не тихим
      // переездом на соседний. Без него vite поднимается на 5176, Playwright
      // ждёт 5175, и две минуты уходят на «сервер не поднялся» вместо
      // «порт занят».
      command: "pnpm --filter @ketocare/web run dev -- --strictPort",
      url: WEB_URL,
      cwd: ROOT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
