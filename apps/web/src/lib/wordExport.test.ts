import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildWordDocument,
  wordFileName,
  type WordDocumentModel,
} from "./wordExport";

/** jsdom's Blob has no `arrayBuffer()`; FileReader it does have. */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function documentXml(model: WordDocumentModel): Promise<string> {
  const blob = await buildWordDocument(model);
  const files = unzipSync(new Uint8Array(await bytesOf(blob)));
  const xml = files["word/document.xml"];
  if (xml === undefined) throw new Error("no word/document.xml in the file");
  return strFromU8(xml);
}

/** Текст абзацев и ячеек по порядку — без разметки. */
function texts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(
    (match) => match[1] ?? "",
  );
}

const MODEL: WordDocumentModel = {
  title: "Меню: Пациент",
  sections: [
    {
      blocks: [
        { kind: "paragraph", small: true, text: "Меню: Пациент" },
        { kind: "heading", level: 1, text: "пн, 16 ноября 2026 г." },
        { kind: "heading", level: 2, text: "Приём 1. Омлет" },
        {
          kind: "table",
          header: ["Продукт", "Вес"],
          rows: [
            ["Яйцо куриное", "40 г"],
            ["Сливки 36%", "52 г"],
          ],
          numeric: [1],
        },
        {
          kind: "steps",
          label: "Приготовление",
          text: "Взбить яйца со сливками.\n\n  Запечь 15 минут.  ",
        },
      ],
    },
    {
      blocks: [{ kind: "heading", level: 1, text: "вт, 17 ноября 2026 г." }],
    },
    {
      blocks: [
        { kind: "table", header: ["Продукт", "Вес"], rows: [["Масло", "5 г"]] },
      ],
    },
  ],
};

describe("buildWordDocument (ADR-0088)", () => {
  it("writes headings, the composition table and the steps in order", async () => {
    const xml = await documentXml(MODEL);

    expect(texts(xml)).toEqual([
      "Меню: Пациент",
      "пн, 16 ноября 2026 г.",
      "Приём 1. Омлет",
      "Продукт",
      "Вес",
      "Яйцо куриное",
      "40 г",
      "Сливки 36%",
      "52 г",
      "Приготовление",
      // Строка на абзац: пустые строки не дают пустых абзацев.
      "Взбить яйца со сливками.",
      "Запечь 15 минут.",
      "вт, 17 ноября 2026 г.",
      "Продукт",
      "Вес",
      "Масло",
      "5 г",
    ]);
    expect(xml).toContain("<w:tbl>");
    // Граммы — по правому краю, как числа на бумаге.
    expect(xml).toContain('<w:jc w:val="right"/>');
  });

  it("starts every section after the first on a new page", async () => {
    const xml = await documentXml(MODEL);

    // Второй день — заголовком, третий начинается таблицей: перенос несёт
    // пустой абзац перед ней.
    expect(xml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(2);
  });
});

describe("wordFileName", () => {
  it("keeps Cyrillic and drops what file systems forbid", () => {
    expect(wordFileName("Курино-овощной суп")).toBe("Курино-овощной суп.docx");
    expect(wordFileName('Меню: "Эмир" 16/22.11 ')).toBe(
      "Меню Эмир 16 22.11.docx",
    );
  });

  it("never yields an empty or hidden name", () => {
    expect(wordFileName("  ..  ")).toBe("KetoCare.docx");
    expect(wordFileName("x".repeat(300))).toHaveLength(125);
  });
});
