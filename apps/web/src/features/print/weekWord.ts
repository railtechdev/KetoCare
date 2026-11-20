import { formatMass } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type {
  WordBlock,
  WordDocumentModel,
  WordSection,
} from "../../lib/wordExport";
import { formatDayLabel, shiftIsoDate } from "../menu/dates";
import type { MenuWeek } from "../menu/useWeek";
import {
  composition,
  dayMetrics,
  itemsOf,
  menuDishCard,
} from "../menu/dayPrintModel";
import { shoppingList } from "../menu/ShoppingListSheet";
import { printableDays } from "../menu/WeekGrid";
import { dishCardBlocks, metricsBlock } from "./printedDishWord";

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

/**
 * Неделя в Word — как на бумаге (`weekSheets`): обзор дня со своей страницы,
 * затем карточка каждого блюда со своей.
 */
export function weekWordSections(
  t: TFunction,
  week: MenuWeek,
  patientName: string,
): WordSection[] {
  const days = printableDays(week);
  const sections: WordSection[] = days.flatMap((day) => {
    const metrics = dayMetrics(t, day);
    const excluded = day.menu?.excluded_products ?? [];
    const items = itemsOf(day);
    const overview: WordBlock[] = [
      {
        kind: "paragraph",
        small: true,
        text: t("menu:week.printTitle", { name: patientName }),
      },
      { kind: "heading", level: 1, text: formatDayLabel(day.date) },
    ];
    if (metrics.length > 0) overview.push(metricsBlock(metrics));
    if (excluded.length > 0) {
      overview.push({
        kind: "paragraph",
        bold: true,
        text: `${t("menu:week.print.excluded")} ${excluded
          .map((product) => product.name_ru)
          .join(", ")}`,
      });
    }
    overview.push(
      {
        kind: "table",
        header: [t("menu:week.meal"), t("menu:week.print.dish")],
        rows: items.map((item) => [
          t("menu:week.mealNumber", { number: item.meal_index }),
          `${item.title ?? t("menu:week.untitled")}: ${composition(t, item)}`,
        ]),
      },
      { kind: "paragraph", small: true, text: t("menu:week.print.cardsNote") },
    );
    return [
      { blocks: overview },
      ...items.map((item) => ({
        blocks: dishCardBlocks(t, menuDishCard(t, day, item)),
      })),
    ];
  });

  // «Что взвесить за неделю» — последним разделом, как последний лист печати.
  const { lines, seasonings } = shoppingList(week);
  if (lines.length > 0) {
    const blocks: WordBlock[] = [
      { kind: "heading", level: 1, text: t("menu:shopping.title") },
      {
        kind: "paragraph",
        text: t("menu:shopping.intro", {
          range: weekRangeLabel(week.start),
          days: days.length,
        }),
      },
      {
        kind: "table",
        header: [
          t("menu:shopping.bought"),
          t("menu:shopping.product"),
          t("menu:shopping.weight"),
          t("menu:shopping.days"),
        ],
        rows: lines.map((line) => [
          "☐",
          line.name,
          t("menu:shopping.grams", { value: formatMass(line.grams) }),
          String(line.days),
        ]),
        numeric: [2, 3],
      },
    ];
    if (seasonings.length > 0) {
      blocks.push({
        kind: "paragraph",
        text: `${t("menu:shopping.seasonings")} ${seasonings.join(", ")}`,
      });
    }
    blocks.push({
      kind: "paragraph",
      small: true,
      text: t("menu:shopping.note"),
    });
    sections.push({ blocks });
  }
  return sections;
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
