import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Тот же алиас, что у приложений: компоненты кита импортируют друг друга
    // через `@ui/...`, и без него их нельзя отрисовать в тестах самого пакета.
    alias: {
      "@ui": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
