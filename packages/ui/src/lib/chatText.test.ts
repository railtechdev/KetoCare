import { describe, expect, it } from "vitest";

import { parseChatInline, parseChatText } from "./chatText";

describe("parseChatInline", () => {
  it("жирный — отдельным куском, звёздочки не печатаются", () => {
    expect(parseChatInline("**Важно:** отметку ставят в меню")).toEqual([
      { text: "Важно:", strong: true },
      { text: " отметку ставят в меню", strong: false },
    ]);
  });

  it("ссылка модели становится текстом без адреса", () => {
    expect(
      parseChatInline("откройте [настройки](https://evil.example/x)"),
    ).toEqual([{ text: "откройте настройки", strong: false }]);
  });

  it("ссылка рядом со скобками снимается так же, адрес не остаётся", () => {
    expect(parseChatInline("см. [[статью](https://evil.example/x)]")).toEqual([
      { text: "см. [статью]", strong: false },
    ]);
  });

  it("длинная серия скобок разбирается за линейное время", () => {
    for (const run of ["[\\", "[]("]) {
      const started = performance.now();
      // The previous pattern took ~0.9 s at 20 000 repeats and grows as the
      // square: 60 000 puts it well past the limit, the fix stays in ms.
      parseChatInline(run.repeat(60_000));
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });

  it("обратные кавычки и одиночные знаки разметки снимаются", () => {
    expect(
      parseChatInline("нажмите `Сохранить` *сразу* _потом_ # тут"),
    ).toEqual([{ text: "нажмите Сохранить сразу потом  тут", strong: false }]);
  });

  it("подчёркивание внутри слова и номер после # остаются", () => {
    expect(parseChatInline("файл meal_plan, пункт #3")).toEqual([
      { text: "файл meal_plan, пункт #3", strong: false },
    ]);
  });
});

describe("parseChatText", () => {
  it("абзацы — по пустой строке, строки внутри абзаца — переносами", () => {
    expect(parseChatText("Первая\nвторая\n\nТретья")).toEqual([
      {
        kind: "paragraph",
        lines: [
          [{ text: "Первая", strong: false }],
          [{ text: "вторая", strong: false }],
        ],
      },
      { kind: "paragraph", lines: [[{ text: "Третья", strong: false }]] },
    ]);
  });

  it("нумерованный и маркированный списки", () => {
    const blocks = parseChatText(
      "Шаги:\n1. Откройте меню\n2. Нажмите «Добавить»\n- кетоны\n• вес",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "list",
      "list",
    ]);
    expect(blocks[1]).toMatchObject({ ordered: true, start: 1 });
    expect(blocks[1]).toMatchObject({
      items: [[{ text: "Откройте меню" }], [{ text: "Нажмите «Добавить»" }]],
    });
    expect(blocks[2]).toMatchObject({
      ordered: false,
      items: [[{ text: "кетоны" }], [{ text: "вес" }]],
    });
  });

  it("заголовок — жирным абзацем, без решёток", () => {
    expect(parseChatText("## Как записать")).toEqual([
      { kind: "heading", line: [{ text: "Как записать", strong: false }] },
    ]);
  });

  it("строка «**Важно**» — не пункт списка", () => {
    expect(parseChatText("**Важно** проверить")[0]).toMatchObject({
      kind: "paragraph",
    });
  });

  it("черта и пустые после очистки строки пропадают", () => {
    expect(parseChatText("---\n***\nТекст")).toEqual([
      { kind: "paragraph", lines: [[{ text: "Текст", strong: false }]] },
    ]);
  });

  it("переводы строк Windows не дают лишних абзацев", () => {
    expect(parseChatText("Один\r\n\r\nДва")).toHaveLength(2);
  });
});
