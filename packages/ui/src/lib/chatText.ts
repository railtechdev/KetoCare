/**
 * The assistant's text as a small, closed set of blocks.
 *
 * The prompt asks the model for plain text, but nothing on the screen enforced
 * it: emphasis came through as asterisks («\*\*Важно:\*\* отметку…», Mini App
 * audit 2026-11, П5). The same text is the body of a knowledge-base article,
 * which is markdown by design.
 *
 * What is kept: paragraphs (blank line), line breaks, **bold**, numbered and
 * bulleted lists one level deep, headings as a bold paragraph. Everything else
 * is reduced to text: links lose their address (the model's text must not
 * send a family anywhere), backticks and stray `*`, `_`, `#` disappear.
 *
 * The result is data, not markup: `ChatText` turns it into React elements, so
 * a model that writes `<img onerror=…>` gets those characters printed, never
 * parsed. There is no `dangerouslySetInnerHTML` on this path and there must
 * never be one.
 */

export interface ChatInline {
  text: string;
  strong: boolean;
}

export type ChatLine = ChatInline[];

export type ChatBlock =
  | { kind: "paragraph"; lines: ChatLine[] }
  | { kind: "heading"; line: ChatLine }
  | { kind: "list"; ordered: boolean; start: number; items: ChatLine[] };

const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const BULLET = /^\s*[-•*]\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const STRONG = /\*\*([^\n]+?)\*\*|__([^\n]+?)__/g;
const WORD = /[\p{L}\p{N}]/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

/** Markup characters left over after bold was taken out. */
function stripMarks(text: string): string {
  return (
    text
      .replace(/[`*]+/g, "")
      // `snake_case` keeps its underscore; `_emphasis_` loses it.
      .replace(/_+/g, (run, offset: number, whole: string) =>
        isWordChar(whole[offset - 1]) && isWordChar(whole[offset + run.length])
          ? run
          : "",
      )
      // «№ 3» is sometimes written «#3» — the number stays readable.
      .replace(/#+/g, (run, offset: number, whole: string) =>
        /\d/.test(whole[offset + run.length] ?? "") ? run : "",
      )
  );
}

/** One line of text → runs of plain and bold text. Empty runs are dropped. */
export function parseChatInline(raw: string): ChatLine {
  const text = raw.replace(LINK, "$1");
  const runs: ChatLine = [];
  const push = (value: string, strong: boolean) => {
    const clean = stripMarks(value);
    if (clean === "") return;
    const last = runs.at(-1);
    if (last !== undefined && last.strong === strong) last.text += clean;
    else runs.push({ text: clean, strong });
  };

  let cursor = 0;
  for (const match of text.matchAll(STRONG)) {
    const index = match.index;
    push(text.slice(cursor, index), false);
    push(match[1] ?? match[2] ?? "", true);
    cursor = index + match[0].length;
  }
  push(text.slice(cursor), false);

  // Leading and trailing spaces of a line carry nothing on the screen.
  const first = runs[0];
  if (first !== undefined) first.text = first.text.trimStart();
  const last = runs.at(-1);
  if (last !== undefined) last.text = last.text.trimEnd();
  return runs.filter((run) => run.text !== "");
}

/** The whole text → blocks, in order. */
export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];

  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    let paragraph: ChatLine[] | null = null;
    let list: Extract<ChatBlock, { kind: "list" }> | null = null;
    const flushParagraph = () => {
      if (paragraph !== null)
        blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = null;
    };
    const flushList = () => {
      if (list !== null) blocks.push(list);
      list = null;
    };

    for (const raw of chunk.split("\n")) {
      if (raw.trim() === "" || RULE.test(raw)) continue;

      const heading = HEADING.exec(raw);
      if (heading !== null) {
        const line = parseChatInline(heading[1] ?? "");
        if (line.length === 0) continue;
        flushParagraph();
        flushList();
        blocks.push({ kind: "heading", line });
        continue;
      }

      const ordered = ORDERED.exec(raw);
      const bullet = ordered === null ? BULLET.exec(raw) : null;
      if (ordered !== null || bullet !== null) {
        const line = parseChatInline(
          (ordered !== null ? ordered[2] : bullet?.[1]) ?? "",
        );
        if (line.length === 0) continue;
        const isOrdered = ordered !== null;
        flushParagraph();
        const current = list as Extract<ChatBlock, { kind: "list" }> | null;
        if (current === null || current.ordered !== isOrdered) {
          flushList();
          list = {
            kind: "list",
            ordered: isOrdered,
            start: ordered !== null ? Number(ordered[1]) : 1,
            items: [line],
          };
        } else {
          current.items.push(line);
        }
        continue;
      }

      const line = parseChatInline(raw);
      if (line.length === 0) continue;
      flushList();
      paragraph ??= [];
      paragraph.push(line);
    }

    flushParagraph();
    flushList();
  }

  return blocks;
}
