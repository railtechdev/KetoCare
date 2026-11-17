import {
  formatGrams,
  formatKcal,
  formatNumber,
  formatRatio,
} from "@ketocare/ui";
import type { components } from "@ketocare/api-client";
import type { TFunction } from "i18next";

import type { WordBlock, WordSection } from "../../lib/wordExport";
import { formatIsoDate } from "../doctor/dates";
import type { Prescription } from "../doctor/types";

type Goal = components["schemas"]["PrescriptionGoalResponse"];

/** Лист назначения в Word — то же, что `PrescriptionSheet`. */
export function prescriptionWordSection(
  t: TFunction,
  active: Prescription,
  patientName: string,
  goal: Goal | undefined,
): WordSection {
  const grams = (value: number | null | undefined) =>
    t("doctor:prescription.confirm.grams", { value: formatGrams(value ?? 0) });

  const blocks: WordBlock[] = [
    {
      kind: "heading",
      level: 1,
      text: t("doctor:prescription.print.title", { name: patientName }),
    },
    {
      kind: "paragraph",
      text: t("doctor:prescription.print.from", {
        date: formatIsoDate(active.effective_from) ?? active.effective_from,
      }),
    },
    {
      kind: "paragraph",
      text: `${t("doctor:fields.ratio")}: ${formatRatio(active.ratio)}`,
    },
    {
      kind: "paragraph",
      text: `${t("doctor:fields.kcal")}: ${t(
        "doctor:prescription.confirm.kcal",
        {
          value: formatKcal(active.kcal_per_day),
        },
      )}`,
    },
    {
      kind: "paragraph",
      text: `${t("doctor:fields.carbsLimit")}: ${grams(active.carbs_limit_g)}`,
    },
    {
      kind: "paragraph",
      text: `${t("doctor:fields.meals")}: ${active.meals_per_day}`,
    },
  ];
  if (active.fluid_ml_per_day != null) {
    blocks.push({
      kind: "paragraph",
      text: `${t("doctor:fields.fluid")}: ${t("doctor:units.mlPerDay", {
        value: formatNumber(active.fluid_ml_per_day, 0),
      })}`,
    });
  }
  if (goal !== undefined) {
    const perMeal = goal.meal !== null;
    const row = (label: string, day: number | null, meal?: number | null) =>
      perMeal ? [label, grams(day), grams(meal)] : [label, grams(day)];
    const rows = [
      row(t("doctor:prescription.goal.fat"), goal.day.fat_g, goal.meal?.fat_g),
    ];
    if (goal.day.protein_g !== null) {
      rows.push(
        row(
          t("doctor:prescription.goal.protein"),
          goal.day.protein_g,
          goal.meal?.protein_g,
        ),
        row(
          t("doctor:prescription.goal.netCarbs"),
          goal.day.net_carbs_g,
          goal.meal?.net_carbs_g,
        ),
      );
    }
    blocks.push({
      kind: "table",
      header: [
        t("doctor:prescription.goal.macro"),
        t("doctor:prescription.goal.day"),
        ...(perMeal ? [t("doctor:prescription.goal.meal")] : []),
      ],
      rows,
      numeric: perMeal ? [1, 2] : [1],
    });
  }
  if (active.restrictions) {
    blocks.push({ kind: "paragraph", text: active.restrictions });
  }
  return { blocks };
}
