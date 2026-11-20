import { formatGrams, formatKcal, formatRatio } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { SheetMetric } from "../../components/print/SheetParts";
import type { WordDocumentModel } from "../../lib/wordExport";
import type { DishView } from "../calculator/DishResultView";
import type { DishRow } from "../calculator/types";
import { dishCardBlocks } from "./printedDishWord";

/** Числа блюда калькулятора — одни на бумагу и Word. */
export function dishMetrics(t: TFunction, dish: DishView): SheetMetric[] {
  const metrics: SheetMetric[] = [
    {
      key: "kcal",
      label: t("calculator:print.kcalLabel"),
      value: t("calculator:print.kcal", { value: formatKcal(dish.kcal) }),
    },
    {
      key: "macros",
      label: t("calculator:print.macrosLabel"),
      value: t("calculator:print.macrosValue", {
        fat: formatGrams(dish.fat_g),
        protein: formatGrams(dish.protein_g),
        carbs: formatGrams(dish.carbs_g),
      }),
    },
  ];
  if (dish.ratio !== null) {
    metrics.unshift({
      key: "ratio",
      label: t("calculator:print.ratioLabel"),
      value: formatRatio(dish.ratio),
    });
  }
  return metrics;
}

/** Карточка блюда в Word — то же, что `DishPrint`. */
export function dishWordModel(
  t: TFunction,
  card: {
    title: string;
    rows: readonly DishRow[];
    dish: DishView;
    steps?: string | null;
  },
): WordDocumentModel {
  return {
    title: card.title,
    sections: [
      {
        blocks: dishCardBlocks(t, {
          title: card.title,
          metrics: dishMetrics(t, card.dish),
          lines: card.rows.map((row) => ({
            name: row.product.name,
            grams: row.grams,
          })),
          steps: card.steps,
          footnote: t("calculator:engineVersion", {
            version: card.dish.engine_version,
          }),
        }),
      },
    ],
  };
}
