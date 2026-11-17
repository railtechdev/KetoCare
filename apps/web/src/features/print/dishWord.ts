import { formatGrams, formatKcal, formatRatio } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { WordDocumentModel } from "../../lib/wordExport";
import type { DishView } from "../calculator/DishResultView";
import type { DishRow } from "../calculator/types";
import { printedDishBlocks } from "./printedDishWord";

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
  const { dish } = card;
  const kcal = t("calculator:print.kcal", { value: formatKcal(dish.kcal) });
  return {
    title: card.title,
    sections: [
      {
        blocks: [
          ...printedDishBlocks(t, {
            level: 1,
            heading: card.title,
            lines: card.rows.map((row) => ({
              name: row.product.name,
              grams: row.grams,
            })),
            summary: [
              dish.ratio === null
                ? kcal
                : `${formatRatio(dish.ratio)}, ${kcal}`,
              t("calculator:print.macros", {
                fat: formatGrams(dish.fat_g),
                protein: formatGrams(dish.protein_g),
                carbs: formatGrams(dish.carbs_g),
              }),
            ],
            steps: card.steps,
          }),
          {
            kind: "paragraph",
            small: true,
            text: t("calculator:engineVersion", {
              version: dish.engine_version,
            }),
          },
        ],
      },
    ],
  };
}
