import { useTranslation } from "react-i18next";

import { DishCard } from "../../components/print/DishCard";
import { dishMetrics } from "../print/dishWord";
import type { DishView } from "./DishResultView";
import type { DishRow } from "./types";

/**
 * Карточка блюда из калькулятора: числа блюда полосой над составом
 * (ADR-0088, ADR-0092). Числа — от сервера, своих подсчётов здесь нет.
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
  const metrics = dishMetrics(t, dish);

  return (
    <DishCard
      title={title}
      metrics={metrics}
      lines={rows.map((row) => ({
        key: row.product.id,
        name: row.product.name,
        grams: row.grams,
      }))}
      steps={steps}
      // Версия расчёта — на бумаге, не на экране (правило 6 PLAN_UI_TEXT).
      footnote={t("engineVersion", { version: dish.engine_version })}
    />
  );
}
