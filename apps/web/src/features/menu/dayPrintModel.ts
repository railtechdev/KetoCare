import { formatGrams, formatKcal, formatMass, formatRatio } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { SheetMetric, WeighLine } from "../../components/print/SheetParts";
import { formatDayLabel } from "./dates";
import type { MenuWeek } from "./useWeek";

/**
 * Содержимое дня меню на бумаге (ADR-0092) — одно на печать (`daySheets`) и
 * на Word (`weekWord`): разойтись им не из чего.
 */
export type WeekDay = MenuWeek["days"][number];
export type DayItem = NonNullable<WeekDay["menu"]>["items"][number];

/** Позиции дня по номеру приёма, а не в порядке записи. */
export function itemsOf(day: WeekDay): DayItem[] {
  return [...(day.menu?.items ?? [])].sort(
    (a, b) => a.meal_index - b.meal_index,
  );
}

/** Строка состава позиции: «Сливки 36% 25 г · Гречка 5 г». */
export function composition(t: TFunction, item: DayItem): string {
  return (item.ingredients ?? [])
    .filter((row) => row.counts_in_calculation !== false)
    .map(
      (row) =>
        `${row.name_ru} ${t("common:print.grams", { value: formatMass(row.grams) })}`,
    )
    .join(" · ");
}

/**
 * Итоги дня рядом с назначением ЭТОГО дня (ADR-0078): калорийность «из»,
 * соотношение «назначено», белок «не меньше», углеводы «не больше». Числа —
 * от сервера; без назначения сравнивать не с чем, и строки сравнения нет.
 */
export function dayMetrics(t: TFunction, day: WeekDay): SheetMetric[] {
  const totals = day.menu?.totals ?? null;
  const prescription = day.menu?.prescription ?? null;
  if (totals === null) return [];
  const versus = (text: () => string) =>
    prescription === null ? undefined : text();
  const metrics: SheetMetric[] = [
    {
      key: "kcal",
      label: t("menu:week.print.kcal"),
      value: t("menu:week.kcal", { value: formatKcal(totals.kcal) }),
      note: versus(() =>
        t("menu:week.print.of", {
          value: formatKcal(prescription?.kcal_per_day ?? 0),
        }),
      ),
    },
  ];
  if (totals.ratio !== null) {
    metrics.push({
      key: "ratio",
      label: t("menu:week.print.ratio"),
      value: formatRatio(totals.ratio),
      note: versus(() =>
        t("menu:week.print.prescribed", {
          value: formatRatio(prescription?.ratio ?? 0),
        }),
      ),
    });
  }
  metrics.push(
    {
      key: "protein",
      label: t("menu:week.print.protein"),
      value: t("menu:week.grams", { value: formatGrams(totals.protein) }),
      note: versus(() =>
        t("menu:week.print.atLeast", {
          value: formatGrams(prescription?.protein_g ?? 0),
        }),
      ),
    },
    {
      key: "carbs",
      label: t("menu:week.print.carbs"),
      value: t("menu:week.grams", { value: formatGrams(totals.carbs) }),
      note: versus(() =>
        t("menu:week.print.atMost", {
          value: formatGrams(prescription?.carbs_limit_g ?? 0),
        }),
      ),
    },
  );
  return metrics;
}

/** Карточка блюда из меню дня — данные одни на бумагу и Word. */
export function menuDishCard(
  t: TFunction,
  day: WeekDay,
  item: DayItem,
): {
  kicker: string;
  title: string;
  lines: WeighLine[];
  seasonings: string[];
  steps: string | null | undefined;
} {
  const ingredients = item.ingredients ?? [];
  return {
    kicker: t("menu:week.print.cardKicker", {
      number: item.meal_index,
      day: formatDayLabel(day.date),
    }),
    title: item.title ?? t("menu:week.untitled"),
    lines: ingredients
      .filter((row) => row.counts_in_calculation !== false)
      .map((row) => ({
        key: row.product_id,
        name: row.name_ru,
        grams: row.grams,
      })),
    seasonings: ingredients
      .filter((row) => row.counts_in_calculation === false)
      .map((row) => row.name_ru),
    steps: item.instructions,
  };
}
