import { formatGrams, formatKcal, formatRatio } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PrintedDish } from "../../components/PrintedDish";
import type { DishView } from "./DishResultView";
import type { DishRow } from "./types";

/**
 * Карточка блюда для печати: что взвесить, что это даёт и как готовить
 * (ADR-0088).
 */
export function DishPrint({
  title,
  rows,
  dish,
  steps,
}: {
  title: string;
  rows: DishRow[];
  dish: DishView;
  steps?: string | null;
}) {
  const { t } = useTranslation("calculator");

  return (
    <div className="flex flex-col gap-3 text-sm">
      <PrintedDish
        level={1}
        heading={title}
        lines={rows.map((row) => ({
          key: row.product.id,
          name: row.product.name,
          grams: row.grams,
        }))}
        steps={steps}
        summary={
          <div>
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
        }
      />
      {/* Версия расчёта — на бумаге, не на экране (правило 6 PLAN_UI_TEXT). */}
      <p className="m-0 text-xs">
        {t("engineVersion", { version: dish.engine_version })}
      </p>
    </div>
  );
}
