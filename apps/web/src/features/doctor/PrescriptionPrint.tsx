import { formatGrams, formatKcal, formatRatio } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PrintButton } from "../../components/PrintButton";
import { usePatient } from "../patients/usePatient";
import { formatIsoDate } from "./dates";
import { usePrescriptionGoal } from "./PrescriptionGoalPreview";
import type { Prescription } from "./types";

/** Лист назначения на руки семье: значения и то, что они дают в граммах. */
export function PrescriptionPrintButton({
  patientId,
  active,
}: {
  patientId: string;
  active: Prescription;
}) {
  const { t } = useTranslation("doctor");
  const patient = usePatient(patientId);
  const goal = usePrescriptionGoal({
    ratio: active.ratio,
    kcalPerDay: active.kcal_per_day,
    proteinG: active.protein_g,
    mealsPerDay: active.meals_per_day,
  });
  const grams = (value: number | null | undefined) =>
    t("prescription.confirm.grams", { value: formatGrams(value ?? 0) });

  return (
    <PrintButton
      label={t("prescription.print.button")}
      disabled={goal.data === undefined || patient.data === undefined}
    >
      <div className="flex flex-col gap-2 text-sm">
        <h1 className="m-0 text-lg font-semibold">
          {t("prescription.print.title", {
            name: patient.data?.full_name ?? "",
          })}
        </h1>
        <p className="m-0">
          {t("prescription.print.from", {
            date: formatIsoDate(active.effective_from) ?? active.effective_from,
          })}
        </p>
        <p className="m-0">
          {t("fields.ratio")}: {formatRatio(active.ratio)}
        </p>
        <p className="m-0">
          {t("fields.kcal")}:{" "}
          {t("prescription.confirm.kcal", {
            value: formatKcal(active.kcal_per_day),
          })}
        </p>
        <p className="m-0">
          {t("fields.carbsLimit")}:{" "}
          {t("prescription.confirm.grams", {
            value: formatGrams(active.carbs_limit_g),
          })}
        </p>
        <p className="m-0">
          {t("fields.meals")}: {active.meals_per_day}
        </p>
        {goal.data !== undefined && (
          <table className="w-full max-w-form">
            <thead>
              <tr>
                <th scope="col" className="text-left font-normal">
                  {t("prescription.goal.macro")}
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
              <tr>
                <th scope="row" className="text-left font-normal">
                  {t("prescription.goal.fat")}
                </th>
                <td className="text-right">{grams(goal.data.day.fat_g)}</td>
                <td className="text-right">{grams(goal.data.meal.fat_g)}</td>
              </tr>
              {goal.data.day.protein_g !== null && (
                <>
                  <tr>
                    <th scope="row" className="text-left font-normal">
                      {t("prescription.goal.protein")}
                    </th>
                    <td className="text-right">
                      {grams(goal.data.day.protein_g)}
                    </td>
                    <td className="text-right">
                      {grams(goal.data.meal.protein_g)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-left font-normal">
                      {t("prescription.goal.netCarbs")}
                    </th>
                    <td className="text-right">
                      {grams(goal.data.day.net_carbs_g)}
                    </td>
                    <td className="text-right">
                      {grams(goal.data.meal.net_carbs_g)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        )}
        {active.restrictions && <p className="m-0">{active.restrictions}</p>}
      </div>
    </PrintButton>
  );
}
