import { formatGrams, formatKcal, formatRatio } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type {
  WordBlock,
  WordDocumentModel,
  WordSection,
} from "../../lib/wordExport";
import { formatDayLabel, shiftIsoDate } from "../menu/dates";
import type { MenuWeek } from "../menu/useWeek";
import { printedDishBlocks } from "./printedDishWord";

/** «16–22.11.2026», через границу месяца — «28.11–04.12.2026». */
export function weekRangeLabel(start: string): string {
  const end = shiftIsoDate(start, 6);
  const [fromYear, fromMonth, fromDay] = start.split("-");
  const [toYear, toMonth, toDay] = end.split("-");
  if (fromYear !== toYear) {
    return `${fromDay}.${fromMonth}.${fromYear}–${toDay}.${toMonth}.${toYear}`;
  }
  if (fromMonth !== toMonth) {
    return `${fromDay}.${fromMonth}–${toDay}.${toMonth}.${toYear}`;
  }
  return `${fromDay}–${toDay}.${toMonth}.${toYear}`;
}

/** Дни недели с блюдами — разделами со своей страницы, как в `WeekPrint`. */
export function weekWordSections(
  t: TFunction,
  week: MenuWeek,
  patientName: string,
): WordSection[] {
  return week.days
    .filter((day) => (day.menu?.items ?? []).length > 0)
    .map((day) => {
      const totals = day.menu?.totals ?? null;
      const excluded = day.menu?.excluded_products ?? [];
      const blocks: WordBlock[] = [
        {
          kind: "paragraph",
          small: true,
          text: t("menu:week.printTitle", { name: patientName }),
        },
        { kind: "heading", level: 1, text: formatDayLabel(day.date) },
      ];
      if (totals !== null) {
        const parts = [
          t("menu:week.printTotals", { kcal: formatKcal(totals.kcal) }),
          t("menu:week.printMacros", {
            fat: formatGrams(totals.fat),
            protein: formatGrams(totals.protein),
            carbs: formatGrams(totals.carbs),
          }),
        ];
        if (totals.ratio !== null) parts.unshift(formatRatio(totals.ratio));
        blocks.push({ kind: "paragraph", text: parts.join(" · ") });
      }
      if (excluded.length > 0) {
        blocks.push({
          kind: "paragraph",
          bold: true,
          text: t("menu:week.printExcluded", {
            names: excluded.map((product) => product.name_ru).join(", "),
          }),
        });
      }
      const items = [...(day.menu?.items ?? [])].sort(
        (a, b) => a.meal_index - b.meal_index,
      );
      for (const item of items) {
        blocks.push(
          ...printedDishBlocks(t, {
            level: 2,
            heading: t("menu:week.printDish", {
              number: item.meal_index,
              title: item.title ?? t("menu:week.untitled"),
            }),
            lines: (item.ingredients ?? []).map((row) => ({
              name: row.name_ru,
              grams: row.grams,
            })),
            steps: item.instructions,
          }),
        );
      }
      return { blocks };
    });
}

export function weekWordModel(
  t: TFunction,
  week: MenuWeek,
  patientName: string,
): WordDocumentModel {
  return {
    title: t("menu:week.printTitle", { name: patientName }),
    sections: weekWordSections(t, week, patientName),
  };
}

/**
 * Имя файла: «Меню — Имя — 16–22.11.2026». Части через тире, пустая (имя ещё
 * не загружено) пропускается, а не оставляет «— —».
 */
export function weekFileName(
  title: string,
  patientName: string,
  start: string,
): string {
  return [title, patientName.trim(), weekRangeLabel(start)]
    .filter((part) => part !== "")
    .join(" — ");
}
