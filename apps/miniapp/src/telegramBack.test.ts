// @vitest-environment node
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Вложенные состояния Mini App закрываются кнопкой «Назад» Telegram.
 *
 * Без неё аппаратная «Назад» на Android закрывает весь Mini App, а не диалог,
 * панель или карточку перед глазами. Подтверждение кита само о Telegram не
 * знает, поэтому в приложении оно ставится только через обёртку.
 */
describe("кнопка «Назад» Telegram", () => {
  const root = import.meta.dirname;
  const sources = globSync("**/*.tsx", { cwd: root }).filter(
    (file) => !file.includes(".test."),
  );

  it("подтверждение кита — только через `TelegramConfirmDialog`", () => {
    const guilty = sources
      .filter((file) => !file.endsWith("TelegramConfirmDialog.tsx"))
      .filter((file) =>
        /<ConfirmDialog\b/.test(readFileSync(join(root, file), "utf8")),
      );
    expect(guilty).toEqual([]);
  });

  it("панель правки записи и сборки дня подписаны на «Назад»", () => {
    for (const file of [
      "features/diary/EntryEditSheet.tsx",
      "features/diary/AddEntry.tsx",
      "features/menu/ComposePanel.tsx",
      "features/recipes/RecipesScreen.tsx",
      "features/session/WebAccessPanel.tsx",
    ]) {
      expect(readFileSync(join(root, file), "utf8"), file).toMatch(
        /useTelegramBack\(/,
      );
    }
  });
});
