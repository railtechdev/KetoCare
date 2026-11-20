import { formatMass } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { SheetMetric, WeighLine } from "../../components/print/SheetParts";
import { numberedSteps } from "../../components/print/steps";
import type { WordBlock } from "../../lib/wordExport";

/** Полоса чисел листа в Word — таблицей: подписи, числа, с чем сравнить. */
export function metricsBlock(metrics: readonly SheetMetric[]): WordBlock {
  const notes = metrics.map((metric) => metric.note ?? "");
  return {
    kind: "table",
    header: metrics.map((metric) => metric.label),
    rows: [
      metrics.map((metric) => metric.value),
      ...(notes.some((note) => note !== "") ? [notes] : []),
    ],
  };
}

/**
 * Карточка блюда в Word — то же, что `DishCard` на бумаге: надпись и название,
 * числа блюда, как взвешивать, состав с отметкой «взвешено», приправы,
 * приготовление и «Важно».
 */
export function dishCardBlocks(
  t: TFunction,
  card: {
    kicker?: string;
    title: string;
    metrics?: readonly SheetMetric[];
    lines: readonly Omit<WeighLine, "key">[];
    seasonings?: readonly string[];
    steps?: string | null;
    footnote?: string;
  },
): WordBlock[] {
  const steps = numberedSteps(card.steps);
  const blocks: WordBlock[] = [];
  if (card.kicker !== undefined) {
    blocks.push({
      kind: "paragraph",
      small: true,
      bold: true,
      text: card.kicker,
    });
  }
  blocks.push({ kind: "heading", text: card.title, level: 1 });
  if ((card.metrics ?? []).length > 0) {
    blocks.push(metricsBlock(card.metrics ?? []));
  }
  blocks.push(
    {
      kind: "paragraph",
      text: `${t("common:print.weighTitle")} ${t("common:print.weighText")}`,
    },
    {
      kind: "table",
      header: [
        t("common:print.weighed"),
        t("common:print.product"),
        t("common:print.weight"),
      ],
      rows: card.lines.map((line) => [
        "☐",
        line.name,
        t("common:print.grams", { value: formatMass(line.grams) }),
      ]),
      numeric: [2],
    },
  );
  if ((card.seasonings ?? []).length > 0) {
    blocks.push({
      kind: "paragraph",
      text: t("common:print.seasonings", {
        names: (card.seasonings ?? []).join(", "),
      }),
    });
  }
  if (steps !== "") {
    blocks.push({ kind: "steps", label: t("common:print.steps"), text: steps });
  }
  blocks.push({
    kind: "paragraph",
    bold: true,
    text: `${t("common:print.importantTitle")} ${t("common:print.importantText")}`,
  });
  if (card.footnote !== undefined) {
    blocks.push({ kind: "paragraph", small: true, text: card.footnote });
  }
  return blocks;
}
