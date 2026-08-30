import { defineConfig } from "vitest/config";

/**
 * Клиент API ходит по сети, поэтому среда — node, а не jsdom: в тестах
 * подменяется глобальный `fetch`, и браузерное окружение здесь ничего не даёт.
 */
export default defineConfig({
  test: { environment: "node", globals: true },
});
