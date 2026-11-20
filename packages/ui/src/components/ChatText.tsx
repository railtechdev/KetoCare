import { Fragment, useMemo } from "react";

import { cn } from "@ui/lib/cn";
import { parseChatText, type ChatLine } from "@ui/lib/chatText";

export interface ChatTextProps {
  /** The assistant's reply or an article body, as the server sent it. */
  text: string;
  className?: string;
}

/**
 * The assistant's text, rendered safely (Mini App audit 2026-11, П5).
 *
 * Paragraphs, line breaks, bold and short lists are shown; the rest of the
 * markup is reduced to text by `parseChatText`. Everything goes through React
 * elements, so the model's text can never become HTML on the page.
 */
export function ChatText({ text, className }: ChatTextProps) {
  const blocks = useMemo(() => parseChatText(text), [text]);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2 break-words", className)}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p key={index} className="m-0 font-semibold">
              <Line line={block.line} />
            </p>
          );
        }
        if (block.kind === "list") {
          const items = block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <Line line={item} />
            </li>
          ));
          return block.ordered ? (
            <ol
              key={index}
              start={block.start}
              className="m-0 flex list-decimal flex-col gap-1 ps-5"
            >
              {items}
            </ol>
          ) : (
            <ul key={index} className="m-0 flex list-disc flex-col gap-1 ps-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={index} className="m-0">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <Line line={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Line({ line }: { line: ChatLine }) {
  return (
    <>
      {line.map((run, index) =>
        run.strong ? (
          <strong key={index} className="font-semibold">
            {run.text}
          </strong>
        ) : (
          <Fragment key={index}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}
