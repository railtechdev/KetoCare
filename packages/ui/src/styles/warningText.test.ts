// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `text-warning` — янтарная подложка, поставленная цветом текста.
 *
 * На белой карточке это 2:1 при требуемых 4.5 (раздел 8.2 ТЗ): «вне цели» в
 * калькуляторе, «разобрано помощником» в дневнике, отказ помощника читались
 * хуже всего на экране — ровно там, где их важно прочесть. Для текста есть
 * `text-warning-strong` (контраст проверяет `contrast.test.ts`), для подложки
 * и полосы — `bg-warning` / `border-warning`.
 *
 * Проверяются все три фронтенда: класс, однажды разрешённый в одном, через
 * неделю копируется в другой.
 */

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const SOURCES = ["packages/ui/src", "apps/web/src", "apps/miniapp/src"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

describe("предупреждение цветом текста", () => {
  it("text-warning не используется как цвет текста", () => {
    const offenders: string[] = [];
    for (const source of SOURCES) {
      for (const path of sourceFiles(join(ROOT, source))) {
        const lines = readFileSync(path, "utf-8").split("\n");
        lines.forEach((line, index) => {
          if (/(?<![\w-])text-warning(?![\w-])/.test(line)) {
            offenders.push(`${path.slice(ROOT.length)}:${index + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
