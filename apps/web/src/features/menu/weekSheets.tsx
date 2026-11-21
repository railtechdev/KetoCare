import { shoppingList } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { PrintedSheetSpec } from "../../components/print/PrintedSheets";
import { weekRangeLabel } from "../print/weekWord";
import { daySheets } from "./daySheets";
import { ShoppingListSheet, shoppingPages } from "./ShoppingListSheet";
import type { MenuWeek } from "./useWeek";
import { printableDays } from "./WeekGrid";

/**
 * Неделя меню на бумаге (ADR-0092): на каждый день — обзор дня и карточки
 * его блюд, в конце — что взвесить за неделю. Одна сборка на печать специалиста и семьи.
 */
export function weekSheets(
  t: TFunction,
  week: MenuWeek,
  patientName: string,
): PrintedSheetSpec[] {
  const days = printableDays(week);
  const sheets: PrintedSheetSpec[] = days.flatMap((day) =>
    daySheets(t, day, patientName),
  );
  const { lines, seasonings } = shoppingList(week);
  const pages = shoppingPages(lines);
  pages.forEach((page, index) => {
    sheets.push({
      key: `shopping-${index}`,
      title: t("menu:shopping.title"),
      aside: patientName,
      code: "KC-SHOP-1",
      content: (
        <ShoppingListSheet
          lines={page}
          seasonings={seasonings}
          rangeLabel={weekRangeLabel(week.start)}
          days={days.length}
          first={index === 0}
          last={index === pages.length - 1}
        />
      ),
    });
  });
  return sheets;
}
