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
  goal: Goal | undefined,
  excluded: readonly string[] = [],
): WordSection {
  const grams = (value: number | null | undefined) =>
    t("doctor:prescription.confirm.grams", { value: formatGrams(value ?? 0) });

  const values: [string, string][] = [
    [t("doctor:fields.ratio"), formatRatio(active.ratio)],
    [
      t("doctor:prescription.print.kcal"),
      t("doctor:prescription.confirm.kcal", {
        value: formatKcal(active.kcal_per_day),
      }),
    ],
    [
      t("doctor:prescription.print.meals"),
      t("doctor:prescription.print.mealsValue", {
        count: active.meals_per_day,
      }),
    ],
  ];
  if (active.fluid_ml_per_day != null) {
    values.push([
      t("doctor:prescription.print.fluid"),
      t("doctor:prescription.print.ml", {
        value: formatNumber(active.fluid_ml_per_day, 0),
      }),
    ]);
  }

  const blocks: WordBlock[] = [
    { kind: "heading", level: 1, text: t("doctor:prescription.print.title") },
    {
      kind: "paragraph",
      text: t("doctor:prescription.print.from", {
        date: formatIsoDate(active.effective_from) ?? active.effective_from,
      }),
    },
    {
      kind: "table",
      header: values.map(([label]) => label),
      rows: [values.map(([, value]) => value)],
    },
  ];

  if (goal !== undefined) {
    const { day, meal } = goal;
    const withProtein = day.protein_g !== null;
    const rows: string[][] = [];
    if (meal !== null) {
      rows.push([
        t("doctor:prescription.print.oneMeal"),
        grams(meal.fat_g),
        ...(withProtein
          ? [grams(meal.protein_g), grams(meal.net_carbs_g)]
          : []),
      ]);
    }
    rows.push([
      t("doctor:prescription.print.perDay"),
      grams(day.fat_g),
      ...(withProtein
        ? [
            t("doctor:prescription.print.atLeast", {
              value: formatGrams(day.protein_g ?? 0),
            }),
            grams(day.net_carbs_g),
          ]
        : []),
    ]);
    blocks.push(
      {
        kind: "heading",
        level: 2,
        text: t("doctor:prescription.print.amounts"),
      },
      {
        kind: "table",
        header: [
          "",
          t("doctor:prescription.goal.fat"),
          ...(withProtein
            ? [
                t("doctor:prescription.goal.protein"),
                t("doctor:prescription.goal.netCarbs"),
              ]
            : []),
        ],
        rows,
        numeric: withProtein ? [1, 2, 3] : [1],
      },
      {
        kind: "paragraph",
        small: true,
        text: t("doctor:prescription.print.carbsNote", {
          value: formatGrams(active.carbs_limit_g),
        }),
      },
    );
  }
  if (active.restrictions) {
    blocks.push({
      kind: "paragraph",
      text: `${t("doctor:prescription.print.restrictions")} ${active.restrictions}`,
    });
  }
  if (excluded.length > 0) {
    blocks.push({
      kind: "paragraph",
      bold: true,
      text: `${t("doctor:prescription.print.excluded")} ${excluded.join(", ")}`,
    });
  }
  blocks.push({
    kind: "paragraph",
    text: [
      t("doctor:prescription.print.signedBy"),
      t("doctor:prescription.print.signature"),
      t("doctor:prescription.print.date"),
    ]
      .map((label) => `${label}: ____________`)
      .join("    "),
  });
  return { blocks };
}
