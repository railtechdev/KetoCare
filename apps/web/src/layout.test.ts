import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Раскладка держится тестами, а не обещаниями.
 *
 * Урок из `docs/SECURITY_REVIEW.md`: правило, записанное только в тексте, через
 * полгода перестаёт выполняться, и заметить это нельзя ничем. До примитивов
 * раскладки во всём `apps/web` было шесть объявлений `lg:grid-cols-*`, ни
 * одного `md:` и ни одного `xl:`, а 75 файлов из 101 не содержали брейкпоинтов
 * вовсе — при том что канон требовал проверять каждый экран на разных ширинах.
 */
const SRC = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * Текст файла без комментариев.
 *
 * Комментарии выброшены потому, что правила этого файла объясняются в коде
 * ссылкой на запрещённый класс: «раньше здесь стояло `sm:grid-cols-2`». Без
 * вычистки объяснение запрета само срабатывало бы как нарушение, и правило
 * приходилось бы обходить, переписывая комментарии — то есть портить их.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const text = code(path);
    for (const match of text.matchAll(pattern)) {
      found.push(`${path.slice(SRC.length + 1)}: ${match[0]}`);
    }
  }
  return found;
}

describe("раскладка экранов", () => {
  it("композиция экрана берётся у примитивов кита, а не пишется классами", () => {
    // `Columns`, `Tiles`, `MetricRow`, `FactList` и `SplitView` — единственные
    // места, где объявляется, сколько на экране столбцов. Проверяются
    // брейкпоинты композиции (`lg` и шире): именно на них раскладка экрана
    // расходится, и именно их до примитивов было шесть штук на тридцать
    // экранов. Пары полей формы (`sm:grid-cols-2`) правило не трогает — это
    // не композиция экрана, а два поля рядом, и канон их разрешает (П6).
    expect(offenders(/\b(?:lg|xl|2xl):grid-cols-\S*/g)).toEqual([]);
  });

  it("ширина экрана задаётся ролью, а не классом на месте", () => {
    // `max-w-content` и `max-w-wide` ставит только `PageLayout` по пропу
    // `width` (правило П34 канона). Класс, поставленный на месте, означает
    // вторую систему ширин — а она однажды разойдётся с первой.
    const found = offenders(/\bmax-w-(?:content|wide)\b/g).filter(
      (entry) => !entry.startsWith("components/PageLayout.tsx"),
    );
    expect(found).toEqual([]);
  });

  it("пары «подпись — значение» спрашивают ширину у блока, а не у окна", () => {
    // `sm:grid-cols-[auto_1fr]` стоял слово в слово в шести файлах и во всех
    // шести спрашивал о ширине ОКНА. Блок при этом живёт и во всю ширину
    // экрана, и в приставной колонке 20rem, и во вкладке карты пациента — в
    // узкой колонке на широком мониторе подпись со значением сходились в 90 px.
    // Ответ — `FactList`: он несёт свой контейнер и потому верен везде.
    expect(offenders(/\bgrid-cols-\[auto_1fr\]/g)).toEqual([]);
  });

  it("перечень пар не раскладывается экранным брейкпоинтом", () => {
    // `<dl>` с `grid-cols-*` — это пары «подпись — значение», и их место в
    // `FactList` или `MetricRow`: оба несут свой контейнер и потому верны и во
    // всю ширину экрана, и в приставной колонке 20rem.
    //
    // Правило добавлено по находке ревью: итоги дня переехали в приставную
    // колонку этим же изменением и остались с `sm:grid-cols-2` — на любом
    // десктопе «Калорийность» и «Углеводы» вставали двумя столбцами по 140 px
    // внутри 320 px. Прежнее правило ловило только `lg` и шире и это
    // пропустило.
    //
    // Пары полей ФОРМЫ правило не трогает: они лежат в `div`, и канон
    // разрешает им две колонки (П6).
    expect(offenders(/<dl[^>]*\bgrid-cols-\S*/g)).toEqual([]);
  });

  it("боковая панель и отступ содержимого объявлены одной ширины", () => {
    // Панель `fixed`, и содержимое отодвигается от неё отдельным классом.
    // Разойдись эти два числа — содержимое уедет под панель, и заметить это
    // можно только глазами на широком экране.
    const shell = readFileSync(join(SRC, "layouts", "AppLayout.tsx"), "utf8");
    const aside = shell.match(/aside className="([^"]*)"/)?.[1] ?? "";
    const content = shell.match(/<div className="(md:pl-[^"]*)"/)?.[1] ?? "";

    expect(aside).toContain("w-16");
    expect(aside).toContain("lg:w-64");
    expect(content).toBe("md:pl-16 lg:pl-64");
  });
});
