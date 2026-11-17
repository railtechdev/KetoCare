import { formatMass } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { WordBlock } from "../../lib/wordExport";

/**
 * Блюдо в файле Word — так же, как `PrintedDish` на бумаге: заголовок, состав
 * таблицей «Продукт — Вес», под ним числа блюда и «Приготовление».
 */
export function printedDishBlocks(
  t: TFunction,
  dish: {
    heading: string;
    level: 1 | 2;
    lines: readonly { name: string; grams: number }[];
    summary?: readonly string[];
    steps?: string | null;
  },
): WordBlock[] {
  const steps = dish.steps?.trim() ?? "";
  const blocks: WordBlock[] = [
    { kind: "heading", text: dish.heading, level: dish.level },
    {
      kind: "table",
      header: [t("common:print.product"), t("common:print.weight")],
      rows: dish.lines.map((line) => [
        line.name,
        t("common:print.grams", { value: formatMass(line.grams) }),
      ]),
      numeric: [1],
    },
  ];
  for (const text of dish.summary ?? []) {
    blocks.push({ kind: "paragraph", text });
  }
  if (steps !== "") {
    blocks.push({ kind: "steps", label: t("common:print.steps"), text: steps });
  }
  return blocks;
}
