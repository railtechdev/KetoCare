import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Порт и адрес API объявлены один раз — в корневом `.env`, как и у кабинета
// (`apps/web/vite.config.ts`). Второе объявление однажды разошлось бы с первым.
const rootDir = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, ["MINIAPP_PORT", "API_PROXY_TARGET"]);

  return {
    plugins: [react(), tailwindcss()],
    envDir: rootDir,
    resolve: {
      alias: {
        "@ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
      },
    },
    server: {
      port: Number(env.MINIAPP_PORT ?? 5174),
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET ?? "http://127.0.0.1:8001",
          changeOrigin: true,
        },
      },
    },
  };
});
