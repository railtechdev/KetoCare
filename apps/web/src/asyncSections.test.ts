import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isAwaitingData, queryState } from "./lib/queryState";

/**
 * Блок данных без сети не врёт пустотой.
 *
 * Сорок с лишним `AsyncSection` кабинета получали `loading={x.isLoading}` и ни
 * один — `waiting`. Без сети запрос стоит на паузе: `isLoading` ложен, данных
 * нет — и блок говорил «записей нет», «ребёнка ещё нет», «назначений нет».
 * Правило записано в `lib/queryState.ts`, держится — здесь.
 */
const SRC = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

/** Открывающие теги `<AsyncSection …>` — до строки с одиноким `>`. */
function openingTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(/<AsyncSection\b[\s\S]*?\n\s*>\n/g)) {
    tags.push(match[0]);
  }
  return tags;
}

describe("блоки данных без сети", () => {
  const tags = sourceFiles(SRC).flatMap((path) =>
    openingTags(readFileSync(path, "utf8")).map((tag) => ({
      file: path.slice(SRC.length + 1),
      tag,
    })),
  );

  it("находит блоки — иначе проверка ниже молчала бы", () => {
    expect(tags.length).toBeGreaterThan(30);
  });

  it("каждый блок знает об ожидании связи", () => {
    const offenders = tags
      .filter(({ tag }) => !/queryState\(|waiting=/.test(tag))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("никакой блок не опирается на одно isLoading", () => {
    const offenders = tags
      .filter(({ tag }) => /loading=\{[^}]*isLoading/.test(tag))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("queryState", () => {
  it("без сети и без данных — ожидание связи, а не пустота", () => {
    const state = queryState({ isPending: true, fetchStatus: "paused" });
    expect(state.loading).toBe(true);
    expect(state.waiting).toMatch(/нет связи/i);
  });

  it("идёт загрузка — загрузка без ожидания", () => {
    expect(queryState({ isPending: true, fetchStatus: "fetching" })).toEqual({
      loading: true,
      waiting: null,
    });
  });

  it("выключенный запрос не крутит скелетон бесконечно", () => {
    expect(queryState({ isPending: true, fetchStatus: "idle" }).loading).toBe(
      false,
    );
    expect(isAwaitingData({ isPending: true, fetchStatus: "idle" })).toBe(
      false,
    );
  });

  it("данные есть — не загрузка, даже если обновление ждёт связи", () => {
    expect(queryState({ isPending: false, fetchStatus: "paused" })).toEqual({
      loading: false,
      waiting: null,
    });
  });

  it("блок из нескольких ответов ждёт каждый", () => {
    const state = queryState(
      { isPending: false, fetchStatus: "idle" },
      { isPending: true, fetchStatus: "paused" },
    );
    expect(state.loading).toBe(true);
    expect(state.waiting).not.toBeNull();
  });
});
