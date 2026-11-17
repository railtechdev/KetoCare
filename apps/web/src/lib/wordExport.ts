/**
 * Выгрузка в Word (.docx) того же, что уходит на печать (ADR-0088,
 * дополнение 17.11.2026).
 *
 * Диетолог правит меню и карточку перед отправкой семье и повару, а печать
 * браузера даёт только PDF. Экраны описывают документ простой моделью —
 * уже переведёнными и отформатированными строками, — а здесь она становится
 * файлом. Чисел и слов этот модуль не знает: формат чисел и словарь остаются
 * там же, где у печатного листа, и Word с бумагой не расходятся.
 *
 * Библиотека `docx` грузится динамическим `import()`: она нужна только по
 * нажатию и в основной пакет кабинета не входит.
 */

export type WordBlock =
  | { kind: "heading"; text: string; level: 1 | 2 }
  | { kind: "paragraph"; text: string; small?: boolean; bold?: boolean }
  | {
      kind: "table";
      header: readonly string[];
      rows: readonly (readonly string[])[];
      /** Номера столбцов, выровненных вправо, — числа. */
      numeric?: readonly number[];
    }
  /** «Приготовление» и шаги под ним — строка текста на абзац. */
  | { kind: "steps"; label: string; text: string };

/** Раздел документа — со своей страницы: день меню, карточка, лист назначения. */
export interface WordSection {
  blocks: readonly WordBlock[];
}

export interface WordDocumentModel {
  title: string;
  sections: readonly WordSection[];
}

const FONT = "Arial";
const BODY_SIZE = 22; // half-points: 11 pt
const SMALL_SIZE = 18; // 9 pt

/** Собирает файл .docx; библиотека подгружается здесь же. */
export async function buildWordDocument(
  model: WordDocumentModel,
): Promise<Blob> {
  const docx = await import("docx");
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;

  type Child = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;

  const line = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

  function paragraph(
    text: string,
    options: { bold?: boolean; small?: boolean; pageBreakBefore?: boolean },
  ) {
    return new Paragraph({
      pageBreakBefore: options.pageBreakBefore,
      spacing: { after: 60 },
      children:
        text === ""
          ? []
          : [
              new TextRun({
                text,
                bold: options.bold,
                size: options.small ? SMALL_SIZE : BODY_SIZE,
                font: FONT,
              }),
            ],
    });
  }

  function cell(text: string, right: boolean, bold: boolean) {
    return new TableCell({
      borders: { top: none, left: none, right: none, bottom: line },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [
        new Paragraph({
          alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold, size: BODY_SIZE, font: FONT })],
        }),
      ],
    });
  }

  function block(item: WordBlock, pageBreakBefore: boolean): Child[] {
    switch (item.kind) {
      case "heading":
        return [
          new Paragraph({
            heading:
              item.level === 1
                ? HeadingLevel.HEADING_1
                : HeadingLevel.HEADING_2,
            pageBreakBefore,
            spacing: { before: item.level === 1 ? 0 : 200, after: 80 },
            children: [
              new TextRun({
                text: item.text,
                bold: true,
                size: item.level === 1 ? 32 : 26,
                font: FONT,
                color: "000000",
              }),
            ],
          }),
        ];
      case "paragraph":
        return [
          paragraph(item.text, {
            bold: item.bold,
            small: item.small,
            pageBreakBefore,
          }),
        ];
      case "table": {
        const numeric = new Set(item.numeric ?? []);
        const rows = [
          new TableRow({
            tableHeader: true,
            children: item.header.map((text, index) =>
              cell(text, numeric.has(index), true),
            ),
          }),
          ...item.rows.map(
            (row) =>
              new TableRow({
                children: row.map((text, index) =>
                  cell(text, numeric.has(index), false),
                ),
              }),
          ),
        ];
        const table = new Table({
          width: { size: 70, type: WidthType.PERCENTAGE },
          rows,
        });
        // A table cannot carry the page break itself: an empty paragraph
        // before it starts the page.
        return pageBreakBefore
          ? [paragraph("", { pageBreakBefore: true }), table]
          : [table];
      }
      case "steps":
        return [
          paragraph(item.label, { bold: true, pageBreakBefore }),
          ...item.text
            .split(/\r?\n/)
            .map((text) => text.trim())
            .filter((text) => text !== "")
            .map((text) => paragraph(text, {})),
        ];
    }
  }

  const children = model.sections.flatMap((section, index) =>
    section.blocks.flatMap((item, position) =>
      block(item, index > 0 && position === 0),
    ),
  );

  const document = new Document({
    title: model.title,
    creator: "KetoCare",
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}

/** Сохраняет файл через обычную загрузку браузера. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Загрузка уже началась: ссылку можно отпускать, но не в том же такте —
  // часть браузеров читает её асинхронно.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Имя файла из названия блюда или ФИО: без символов, которые запрещают
 * Windows и macOS, без управляющих и не длиннее 120 знаков.
 */
export function wordFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();
  return `${cleaned === "" ? "KetoCare" : cleaned}.docx`;
}
