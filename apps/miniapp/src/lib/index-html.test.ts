import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Страница обязана подключать скрипт Telegram.
 *
 * Без него `window.Telegram.WebApp` не появляется, и приложение, открытое
 * КНОПКОЙ В ЧАТЕ, считает себя открытым вне Telegram: показывает «откройте
 * кнопкой в чате» — тупик, из которого семье не выйти. Проверено на живом
 * стенде; тест стоит здесь, потому что пропажу тега не заметит ни сборка, ни
 * типы, ни один экранный тест — все они работают без Telegram по замыслу.
 */
describe("index.html", () => {
  // Путь от корня пакета, а не от файла теста: под jsdom `import.meta.url`
  // указывает не туда, откуда виден index.html.
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  it("подключает скрипт Telegram", () => {
    expect(html).toContain("https://telegram.org/js/telegram-web-app.js");
  });

  it("подключает его ДО модуля приложения", () => {
    // Иначе приложение стартует раньше, чем появится window.Telegram, и первая
    // же проверка «мы в Telegram?» отвечает «нет».
    expect(html.indexOf("telegram-web-app.js")).toBeLessThan(
      html.indexOf("/src/main.tsx"),
    );
  });
});
