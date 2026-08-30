import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionRouter } from "../test/SectionRouter";
import { SectionLink } from "./SectionLink";

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

  it("не тащат состояние прошлого раздела в новый", async () => {
    // `?tab=verify` калькулятора приезжал на главную и оставался в адресе:
    // вкладка, объект и строка поиска принадлежат своему экрану, а на другом
    // означают уже не то. Проверяется адрес ссылки, а не текст исходника:
    // проверка по тексту ломается от любой правки, ничего не гарантируя.
    render(
      <SectionRouter
        section="calculator"
        search={{ tab: "verify", item: "dish-1", q: "масло", patient: "p1" }}
      >
        <SectionLink section="home">На главную</SectionLink>
      </SectionRouter>,
    );

    const href = (
      await screen.findByRole("link", { name: "На главную" })
    ).getAttribute("href");
    expect(href).toBe("/app/home?patient=p1");
  });

  it("открывают нужную вкладку, когда она задана явно", async () => {
    // Очередь врача ведёт в карту сразу на том, из-за чего пациент в неё попал.
    render(
      <SectionRouter section="home">
        <SectionLink section="patients" patient="p9" tab="diary">
          К пациенту
        </SectionLink>
      </SectionRouter>,
    );

    const href = (
      await screen.findByRole("link", { name: "К пациенту" })
    ).getAttribute("href");
    expect(decodeURIComponent(href ?? "")).toContain("tab=diary");
    expect(decodeURIComponent(href ?? "")).toContain("patient=p9");
  });
});
