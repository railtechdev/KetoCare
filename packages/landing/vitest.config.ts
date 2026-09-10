import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Расчёт демо-калькулятора — чистые функции: браузерное окружение здесь
    // не нужно и только замедлило бы обязательный CI-job.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
