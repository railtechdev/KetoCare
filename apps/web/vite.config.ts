import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
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
