import { formatMass } from "@ketocare/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface PrintedLine {
  key: string;
  name: string;
  grams: number;
}

/**
 * One dish on paper, the way a family or a cook reads it: what to weigh as a
 * table, then how to cook it (ADR-0088).
 *
 * Before, the card and the printed menu were a run of «name — grams» lines
 * with no steps: a dietitian sends them to parents and cooks, and they could
 * not tell where one dish ended (dietitian, 17.11.2026). Shared by the dish
 * card and the printed week, so both read the same.
 */
export function PrintedDish({
  heading,
  lines,
  steps,
  summary,
  level = 2,
}: {
  heading: ReactNode;
  lines: readonly PrintedLine[];
  steps?: string | null;
  /** Numbers of the dish under its composition. */
  summary?: ReactNode;
  /** Heading level: the card is a page of its own, a menu dish sits in a day. */
  level?: 1 | 2 | 3;
}) {
  const { t } = useTranslation("common");
  const Heading = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
  const text = steps?.trim() ?? "";

  return (
    <article className="flex break-inside-avoid flex-col gap-2">
      <Heading className="m-0 text-base font-semibold">{heading}</Heading>
      <table className="w-full max-w-md border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/40">
            <th scope="col" className="py-0.5 pr-4 text-left font-medium">
              {t("print.product")}
            </th>
            <th scope="col" className="py-0.5 text-right font-medium">
              {t("print.weight")}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-b border-black/10">
              <td className="py-0.5 pr-4">{line.name}</td>
              <td className="py-0.5 text-right tabular-nums whitespace-nowrap">
                {t("print.grams", { value: formatMass(line.grams) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary}
      {text !== "" && (
        <div className="flex flex-col gap-1">
          <p className="m-0 font-medium">{t("print.steps")}</p>
          <p className="m-0 whitespace-pre-line">{text}</p>
        </div>
      )}
    </article>
  );
}
