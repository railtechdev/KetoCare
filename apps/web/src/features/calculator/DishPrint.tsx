import { formatGrams, formatKcal, formatMass, formatRatio } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { DishView } from "./DishResultView";
import type { DishRow } from "./types";

/** Карточка блюда для печати: что взвесить и что это даёт. */
export function DishPrint({
  title,
  rows,
  dish,
}: {
  title: string;
  rows: DishRow[];
  dish: DishView;
}) {
  const { t } = useTranslation("calculator");

  return (
    <div className="flex flex-col gap-2 text-sm">
      <h1 className="m-0 text-lg font-semibold">{title}</h1>
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li key={row.product.id}>
            {row.product.name} —{" "}
            {t("print.grams", { value: formatMass(row.grams) })}
          </li>
        ))}
      </ul>
      <p className="m-0">
        {dish.ratio !== null && <>{formatRatio(dish.ratio)}, </>}
        {t("print.kcal", { value: formatKcal(dish.kcal) })}
      </p>
      <p className="m-0">
        {t("print.macros", {
          fat: formatGrams(dish.fat_g),
          protein: formatGrams(dish.protein_g),
          carbs: formatGrams(dish.carbs_g),
        })}
      </p>
    </div>
  );
}
