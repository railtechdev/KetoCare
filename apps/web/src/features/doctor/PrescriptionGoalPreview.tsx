import { formatGrams, RECALC_DELAY_MS, useDebouncedValue } from "@ketocare/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";

export interface PrescriptionGoalInput {
  ratio: number;
  kcalPerDay: number;
  proteinG: number;
  mealsPerDay: number;
}

function isComplete(input: PrescriptionGoalInput): boolean {
  return (
    input.ratio >= 1 &&
    input.kcalPerDay > 0 &&
    input.proteinG >= 0 &&
    Number.isInteger(input.mealsPerDay) &&
    input.mealsPerDay >= 1 &&
    input.mealsPerDay <= 10
  );
}

/**
 * Назначение в граммах: жир, белок и чистые углеводы на сутки и на приём.
 *
 * Считает сервер: своей арифметики в браузере нет. Предпросмотр ничего не
 * запрещает, допустимость сочетания проверяется при сохранении.
 */
export function PrescriptionGoalPreview({
  input,
}: {
  input: PrescriptionGoalInput;
}) {
  const { t } = useTranslation("doctor");
  const debounced = useDebouncedValue(JSON.stringify(input), RECALC_DELAY_MS);
  const current: PrescriptionGoalInput = JSON.parse(
    debounced,
  ) as PrescriptionGoalInput;
  const enabled = isComplete(current);

  const query = useQuery({
    queryKey: ["calc", "prescription-goal", debounced],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.POST("/api/v1/calc/prescription-goal", {
        body: {
          ratio: current.ratio,
          kcal_per_day: current.kcalPerDay,
          protein_g: current.proteinG,
          meals_per_day: current.mealsPerDay,
        },
      });
      if (error || !data) {
        throw error ?? new Error("Empty prescription goal response");
      }
      return data;
    },
  });

  if (!enabled || query.data === undefined) return null;
  const { day, meal } = query.data;
  const proteinFits = day.protein_g !== null;

  const rows = [
    { key: "fat", day: day.fat_g, meal: meal.fat_g },
    ...(proteinFits
      ? [
          { key: "protein", day: day.protein_g, meal: meal.protein_g },
          { key: "netCarbs", day: day.net_carbs_g, meal: meal.net_carbs_g },
        ]
      : []),
    { key: "nonFat", day: day.non_fat_g, meal: meal.non_fat_g },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <table className="w-full max-w-form text-sm tabular-nums">
        <caption className="pb-1.5 text-left font-medium">
          {t("prescription.goal.title")}
        </caption>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="text-left font-normal">
              <span className="sr-only">{t("prescription.goal.macro")}</span>
            </th>
            <th scope="col" className="text-right font-normal">
              {t("prescription.goal.day")}
            </th>
            <th scope="col" className="text-right font-normal">
              {t("prescription.goal.meal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border/60">
              <th scope="row" className="py-1 text-left font-normal">
                {t(`prescription.goal.${row.key}`)}
              </th>
              <td className="py-1 text-right">
                {t("prescription.confirm.grams", {
                  value: formatGrams(row.day ?? 0),
                })}
              </td>
              <td className="py-1 text-right">
                {t("prescription.confirm.grams", {
                  value: formatGrams(row.meal ?? 0),
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!proteinFits && (
        <p className="m-0 text-sm text-warning-strong">
          {t("prescription.goal.proteinTooHigh")}
        </p>
      )}
    </div>
  );
}
