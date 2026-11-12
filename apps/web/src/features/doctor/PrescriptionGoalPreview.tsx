import {
  formatGrams,
  formatKcal,
  formatNumber,
  formatRatio,
  RECALC_DELAY_MS,
  useDebouncedValue,
} from "@ketocare/ui";
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
  return input.ratio >= 1 && input.kcalPerDay > 0 && input.proteinG >= 0;
}

/**
 * Число приёмов для расчёта на приём; без него сутки всё равно считаются.
 * Углеводы назначения выводятся из суток, и пустое поле приёмов оставляло их
 * пустыми (замечание диетолога 12.11.2026).
 */
function validMeals(meals: number): number | undefined {
  return Number.isInteger(meals) && meals >= 1 && meals <= 10
    ? meals
    : undefined;
}

/** Граммы назначения от сервера; без полного ввода запроса нет. */
export function usePrescriptionGoal(input: PrescriptionGoalInput) {
  return useQuery({
    queryKey: [
      "calc",
      "prescription-goal",
      { ...input, mealsPerDay: validMeals(input.mealsPerDay) ?? null },
    ],
    enabled: isComplete(input),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.POST("/api/v1/calc/prescription-goal", {
        body: {
          ratio: input.ratio,
          kcal_per_day: input.kcalPerDay,
          protein_g: input.proteinG,
          meals_per_day: validMeals(input.mealsPerDay),
        },
      });
      if (error || !data) {
        throw error ?? new Error("Empty prescription goal response");
      }
      return data;
    },
  });
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
  const query = usePrescriptionGoal(
    JSON.parse(debounced) as PrescriptionGoalInput,
  );

  if (query.data === undefined || !query.isEnabled) return null;
  const { day, meal, dietary_unit_kcal: unitKcal } = query.data;
  const proteinFits = day.protein_g !== null;
  const { ratio, kcalPerDay } = JSON.parse(debounced) as PrescriptionGoalInput;

  const rows = [
    { key: "fat", day: day.fat_g, meal: meal?.fat_g },
    ...(proteinFits
      ? [
          { key: "protein", day: day.protein_g, meal: meal?.protein_g },
          { key: "netCarbs", day: day.net_carbs_g, meal: meal?.net_carbs_g },
        ]
      : []),
    { key: "nonFat", day: day.non_fat_g, meal: meal?.non_fat_g },
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
            {meal !== null && (
              <th scope="col" className="text-right font-normal">
                {t("prescription.goal.meal")}
              </th>
            )}
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
              {meal !== null && (
                <td className="py-1 text-right">
                  {t("prescription.confirm.grams", {
                    value: formatGrams(row.meal ?? 0),
                  })}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Арифметика диетической единицы — так, как её объясняет слайд Yonsei,
          присланный клиникой: врач видит, откуда взялись граммы. Числа — от
          сервера, браузер только подставляет их в фразу. */}
      <p className="m-0 max-w-form text-sm text-muted-foreground">
        {t("prescription.goal.unit", {
          ratio: formatRatio(ratio),
          times: formatNumber(ratio, Number.isInteger(ratio) ? 0 : 1),
          // 2,5 : 1 даёт 26,5 ккал: целые ккал здесь соврали бы.
          unitKcal: formatNumber(unitKcal, Number.isInteger(unitKcal) ? 0 : 1),
          kcal: formatKcal(kcalPerDay),
          units: formatNumber(day.non_fat_g, 1),
        })}
      </p>
      {!proteinFits && (
        <p className="m-0 text-sm text-warning-strong">
          {t("prescription.goal.proteinTooHigh")}
        </p>
      )}
    </div>
  );
}
