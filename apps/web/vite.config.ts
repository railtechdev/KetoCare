import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Единственный `.env` в проекте лежит в корне монорепозитория — оттуда его берут
// и Makefile, и Python-приложения. `process.cwd()` здесь — это `apps/web`
// (`pnpm --filter` запускает vite в каталоге пакета), и корневой файл не читался:
// `WEB_PORT` молча терялся, vite брал 5173, находил его занятым соседним проектом
// и уезжал на 5174. Настроенным окружение при этом выглядело — просто не работало.
const rootDir = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  // Читаются ровно две нужные переменные, а не весь файл (третий аргумент —
  // список префиксов, сверка по началу строки). В корневом `.env` лежат
  // SECRET_KEY, BOT_TOKEN, ANTHROPIC_API_KEY и строка подключения к БД; им
  // нечего делать в объекте конфигурации, даже если сейчас он никуда не
  // подставляется. Одна будущая правка вида `define: env` — и они в бандле.
  const env = loadEnv(mode, rootDir, ["WEB_PORT", "API_PROXY_TARGET"]);

  return {
    plugins: [react(), tailwindcss()],
    // envDir — для собственной загрузки переменных vite (`import.meta.env`).
    // Без него loadEnv выше и клиентские переменные читали бы разные файлы.
    //
    // `envPrefix` намеренно оставлен дефолтным (`VITE_`): в клиентский бандл
    // и в подстановку по `index.html` попадают только переменные с этим
    // префиксом. Расширить его здесь — значит открыть корневой `.env` наружу.
    envDir: rootDir,
    resolve: {
      alias: {
        "@ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        // Разработка идёт с одного origin: тогда httpOnly cookie отправляются
        // браузером без настройки CORS и SameSite под localhost.
        // Порт настраивается — 8000 часто занят другими проектами.
        "/api": {
          target: env.API_PROXY_TARGET ?? "http://127.0.0.1:8001",
          changeOrigin: true,
        },
      },
    },
  };
});
