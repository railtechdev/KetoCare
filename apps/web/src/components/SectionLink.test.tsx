import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Выбранный ребёнок живёт в адресе, а TanStack Router параметры поиска при
 * переходе не переносит. Забыть об этом в новой ссылке легко: сборка не падает,
 * тип не жалуется — родитель двоих детей просто теряет выбор на каждом переходе
 * и снова упирается в «выберите ребёнка».
 *
 * Поэтому проверка идёт по исходникам: обычному `Link` на раздел здесь не место.
 */
const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

describe("ссылки на разделы кабинета", () => {
  it("ведут через SectionLink, а не через голый Link", () => {
    const offenders = sourceFiles(SRC).filter((path) => {
      if (path.endsWith(join("components", "SectionLink.tsx"))) return false;
      return readFileSync(path, "utf8").includes('to="/app/$section"');
    });

    expect(offenders.map((path) => path.slice(SRC.length + 1))).toEqual([]);
  });
});
