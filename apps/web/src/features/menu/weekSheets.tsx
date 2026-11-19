import type { TFunction } from "i18next";

import type { PrintedSheetSpec } from "../../components/print/PrintedSheets";
import { weekRangeLabel } from "../print/weekWord";
import { formatDayLabel } from "./dates";
import { ShoppingListSheet, shoppingList } from "./ShoppingListSheet";
import type { MenuWeek } from "./useWeek";
import { printableDays, WeekDayPrint } from "./WeekGrid";

/**
 * Неделя меню на бумаге (ADR-0092): лист на каждый день и в конце — что
 * взвесить за неделю. Одна сборка на печать специалиста и семьи.
 */
export function weekSheets(
  t: TFunction,
  week: MenuWeek,
  patientName: string,
): PrintedSheetSpec[] {
  const days = printableDays(week);
  const sheets: PrintedSheetSpec[] = days.map((day) => ({
    key: day.date,
    title: t("menu:shopping.dayTitle", { day: formatDayLabel(day.date) }),
    aside: patientName,
    code: "KC-WEEK-1",
    content: <WeekDayPrint day={day} patientName={patientName} />,
  }));
  if (days.length > 0 && shoppingList(week).lines.length > 0) {
    sheets.push({
      key: "shopping",
      title: t("menu:shopping.title"),
      aside: patientName,
      code: "KC-SHOP-1",
      content: (
        <ShoppingListSheet
          week={week}
          rangeLabel={weekRangeLabel(week.start)}
        />
      ),
    });
  }
  return sheets;
}
