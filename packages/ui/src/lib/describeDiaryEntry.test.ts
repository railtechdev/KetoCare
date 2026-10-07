// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DIARY_ENTRY_KEYS,
  describeDiaryEntry,
  type DiaryEntryNames,
} from "./describeDiaryEntry";

/** Перевод-эхо: ключ и подстановки, чтобы видеть, что именно спрошено. */
function echo(key: string, values?: Record<string, string>): string {
  return values === undefined ? key : `${key} ${JSON.stringify(values)}`;
}

const NAMES: DiaryEntryNames = {
  seizureTypes: new Map([["t1", "Тонико-клонический"]]),
  durationOptions: new Map([["d1", "от 10 до 30 минут"]]),
  medications: new Map([["m1", "Вальпроат"]]),
};

const SEIZURE = {
  kind: "seizures" as const,
  seizure_type_id: "t1",
  duration_sec: null,
  duration_option_id: null,
  count: 1,
  description: null,
  triggers: null,
};

describe("запись дневника словами (общая для кабинета и Mini App)", () => {
  it("измеренная длительность — секундами", () => {
    const { lines } = describeDiaryEntry(
      { ...SEIZURE, duration_sec: 90 },
      NAMES,
      echo,
    );
    expect(lines).toEqual(['entry.durationSec {"value":"90"}']);
  });

  it("интервал со слов не превращается в секунды (ADR-0020)", () => {
    const { lines } = describeDiaryEntry(
      { ...SEIZURE, duration_option_id: "d1" },
      NAMES,
      echo,
    );
    expect(lines).toEqual([
      'entry.durationInterval {"value":"от 10 до 30 минут"}',
    ]);
  });

  it("незнакомый вариант шкалы — «указано словами», а не молчание", () => {
    const { lines } = describeDiaryEntry(
      { ...SEIZURE, duration_option_id: "нет-такого" },
      NAMES,
      echo,
    );
    expect(lines).toEqual([
      'entry.durationInterval {"value":"entry.durationUnnamed"}',
    ]);
  });

  it("число приступов — только когда их больше одного", () => {
    expect(describeDiaryEntry(SEIZURE, NAMES, echo).lines).toEqual([]);
    expect(
      describeDiaryEntry({ ...SEIZURE, count: 3 }, NAMES, echo).lines,
    ).toEqual(['entry.count {"value":"3"}']);
  });

  it("кетоны: число по-русски и способ замера", () => {
    expect(
      describeDiaryEntry(
        { kind: "ketones", value: 1.8, method: "blood" },
        NAMES,
        echo,
      ),
    ).toEqual({
      title: 'entry.ketones {"value":"1,8"}',
      lines: ["entry.ketonesBlood"],
    });
  });

  it("лекарство вне схемы — без имени, а не с идентификатором", () => {
    expect(
      describeDiaryEntry(
        { kind: "medications", medication_id: "x", taken: false },
        NAMES,
        echo,
      ).title,
    ).toBe("entry.medicationUnknown");
  });
});

describe("словари обоих каналов дают каждый ключ описания", () => {
  const root = fileURLToPath(new URL("../../../..", import.meta.url));
  const read = (path: string) =>
    JSON.parse(readFileSync(`${root}${path}`, "utf-8")) as Record<
      string,
      unknown
    >;

  function lookup(dictionary: Record<string, unknown>, path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        dictionary,
      );
  }

  it.each([
    ["кабинет", "apps/web/src/locales/ru/diary.json", ""],
    ["Mini App, русский", "apps/miniapp/src/locales/ru/app.json", "diary."],
    ["Mini App, узбекский", "apps/miniapp/src/locales/uz/app.json", "diary."],
  ])("%s", (_name, path, prefix) => {
    const dictionary = read(path);
    const missing = DIARY_ENTRY_KEYS.filter(
      (key) => typeof lookup(dictionary, `${prefix}${key}`) !== "string",
    );
    expect(missing).toEqual([]);
  });
});
