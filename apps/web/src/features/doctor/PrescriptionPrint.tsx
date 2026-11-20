import {
  formatGrams,
  formatKcal,
  formatNumber,
  formatRatio,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import {
  SheetHeading,
  SheetMetrics,
  SheetNotice,
  SheetSubheading,
  SignatureLines,
  type SheetMetric,
} from "../../components/print/SheetParts";
import { formatIsoDate } from "./dates";
import { usePrescriptionGoal } from "./PrescriptionGoalPreview";
import type { Prescription } from "./types";

/**
 * Лист назначения для семьи (ADR-0092, макет «Назначение»): четыре числа
 * назначения, граммы на приём и на день, исключённое ребёнку и строки для
 * подписи. Граммы считает сервер (`/calc/prescription-goal`); калорийность
 * приёма не печатается — делить суточную норму по приёмам клиника оставила
 * свободным (вопрос 24).
 */
export function PrescriptionSheet({
  active,
  excluded = [],
}: {
  active: Prescription;
  /** Исключённые продукты и метки аллергий из карты ребёнка. */
  excluded?: readonly string[];
}) {
  const { t } = useTranslation("doctor");
  const goal = usePrescriptionGoal({
    ratio: active.ratio,
    kcalPerDay: active.kcal_per_day,
    proteinG: active.protein_g,
    mealsPerDay: active.meals_per_day,
  });
  const grams = (value: number | null | undefined) =>
    t("prescription.confirm.grams", { value: formatGrams(value ?? 0) });

  const metrics: SheetMetric[] = [
    {
      key: "ratio",
      label: t("fields.ratio"),
      value: formatRatio(active.ratio),
    },
    {
      key: "kcal",
      label: t("prescription.print.kcal"),
      value: t("prescription.confirm.kcal", {
        value: formatKcal(active.kcal_per_day),
      }),
    },
    {
      key: "meals",
      label: t("prescription.print.meals"),
      value: t("prescription.print.mealsValue", {
        count: active.meals_per_day,
      }),
    },
  ];
  if (active.fluid_ml_per_day != null) {
    metrics.push({
      key: "fluid",
      label: t("prescription.print.fluid"),
      value: t("prescription.print.ml", {
        value: formatNumber(active.fluid_ml_per_day, 0),
      }),
    });
  }

  const day = goal.data?.day;
  const meal = goal.data?.meal ?? null;

  return (
    <div className="flex flex-col gap-[5mm] text-[12pt] leading-snug">
      <SheetHeading
        title={t("prescription.print.title")}
        lead={t("prescription.print.from", {
          date: formatIsoDate(active.effective_from) ?? active.effective_from,
        })}
      />

      {/* Четыре числа — два на два, как в макете; три — одной строкой, без
          пустой клетки. */}
      <SheetMetrics
        metrics={metrics}
        columns={metrics.length === 4 ? 2 : metrics.length}
      />

      {day !== undefined && (
        <div className="flex flex-col gap-[2mm]">
          <SheetSubheading>{t("prescription.print.amounts")}</SheetSubheading>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-[#1a1f2e] text-[9.5pt] text-[#4a5263]">
                <td className="py-[1.5mm]" />
                <th scope="col" className="py-[1.5mm] text-right font-semibold">
                  {t("prescription.goal.fat")}
                </th>
                {day.protein_g !== null && (
                  <>
                    <th
                      scope="col"
                      className="py-[1.5mm] text-right font-semibold"
                    >
                      {t("prescription.goal.protein")}
                    </th>
                    <th
                      scope="col"
                      className="py-[1.5mm] text-right font-semibold"
                    >
                      {t("prescription.goal.netCarbs")}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {meal !== null && (
                <tr className="border-b border-[#c9ced8]">
                  <th scope="row" className="py-[2mm] text-left font-semibold">
                    {t("prescription.print.oneMeal")}
                  </th>
                  <td className="py-[2mm] text-right">{grams(meal.fat_g)}</td>
                  {day.protein_g !== null && (
                    <>
                      <td className="py-[2mm] text-right">
                        {grams(meal.protein_g)}
                      </td>
                      <td className="py-[2mm] text-right">
                        {grams(meal.net_carbs_g)}
                      </td>
                    </>
                  )}
                </tr>
              )}
              <tr className="border-b border-[#c9ced8]">
                <th scope="row" className="py-[2mm] text-left font-semibold">
                  {t("prescription.print.perDay")}
                </th>
                <td className="py-[2mm] text-right">{grams(day.fat_g)}</td>
                {day.protein_g !== null && (
                  <>
                    <td className="py-[2mm] text-right">
                      {t("prescription.print.atLeast", {
                        value: formatGrams(day.protein_g),
                      })}
                    </td>
                    <td className="py-[2mm] text-right">
                      {grams(day.net_carbs_g)}
                    </td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
          <p className="m-0 text-[10.5pt] text-[#4a5263]">
            {t("prescription.print.carbsNote", {
              value: formatGrams(active.carbs_limit_g),
            })}
          </p>
        </div>
      )}

      {active.restrictions && (
        <p className="m-0">
          <b>{t("prescription.print.restrictions")}</b> {active.restrictions}
        </p>
      )}

      {excluded.length > 0 && (
        <SheetNotice tone="warning" title={t("prescription.print.excluded")}>
          {excluded.join(", ")}
        </SheetNotice>
      )}

      <SignatureLines
        labels={[
          t("prescription.print.signedBy"),
          t("prescription.print.signature"),
          t("prescription.print.date"),
        ]}
      />
    </div>
  );
}
