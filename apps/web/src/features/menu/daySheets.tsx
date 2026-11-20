import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { DishCard } from "../../components/print/DishCard";
import type { PrintedSheetSpec } from "../../components/print/PrintedSheets";
import {
  SheetHeading,
  SheetMetrics,
  SheetNotice,
} from "../../components/print/SheetParts";
import { formatDayLabel } from "./dates";
import {
  composition,
  dayMetrics,
  itemsOf,
  menuDishCard,
  type DayItem,
  type WeekDay,
} from "./dayPrintModel";

/** «ср, 18 ноября» в заголовке листа — с прописной. */
function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * День меню на одном листе (ADR-0092, макет «Меню на день»): итоги дня рядом с
 * назначением, исключённое ребёнку и приёмы с составом строкой. Граммы и
 * приготовление каждого блюда — на его карточке следующим листом.
 */
export function DayOverviewSheet({ day }: { day: WeekDay }) {
  const { t } = useTranslation("menu");
  const metrics = dayMetrics(t, day);
  const excluded = day.menu?.excluded_products ?? [];

  return (
    <div className="flex flex-col gap-[5mm] text-[12pt] leading-snug">
      <SheetHeading title={capitalized(formatDayLabel(day.date))} />
      {metrics.length > 0 && <SheetMetrics metrics={metrics} />}
      {excluded.length > 0 && (
        <SheetNotice tone="warning" title={t("week.print.excluded")}>
          {excluded.map((product) => product.name_ru).join(", ")}
        </SheetNotice>
      )}
      <div className="flex flex-col border-b border-[#c9ced8]">
        {itemsOf(day).map((item, index) => (
          <div
            key={item.id}
            className={`grid break-inside-avoid grid-cols-[24mm_minmax(0,1fr)] gap-[4mm] py-[3mm] ${
              index === 0
                ? "border-t-2 border-[#1a1f2e]"
                : "border-t border-[#c9ced8]"
            }`}
          >
            <p className="m-0 text-[10.5pt] font-bold text-[#2c5fe0] uppercase">
              {t("week.mealNumber", { number: item.meal_index })}
            </p>
            <div>
              <p className="m-0 text-[13pt] font-semibold">
                {item.title ?? t("week.untitled")}
              </p>
              <p className="m-0 mt-[1mm] text-[11pt] text-[#3d4556]">
                {composition(t, item)}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="m-0 text-[10.5pt] text-[#4a5263]">
        {t("week.print.cardsNote")}
      </p>
    </div>
  );
}

function MenuDishCard({ day, item }: { day: WeekDay; item: DayItem }) {
  const { t } = useTranslation("menu");
  return <DishCard {...menuDishCard(t, day, item)} />;
}

/** День меню на бумаге: обзор дня и карточка на каждое блюдо. */
export function daySheets(
  t: TFunction,
  day: WeekDay,
  patientName: string,
): PrintedSheetSpec[] {
  const label = formatDayLabel(day.date);
  return [
    {
      key: day.date,
      title: t("menu:shopping.dayTitle", { day: label }),
      aside: patientName,
      code: "KC-WEEK-1",
      content: <DayOverviewSheet day={day} />,
    },
    ...itemsOf(day).map((item) => ({
      key: `${day.date}-${item.id}`,
      title: t("common:print.dishSheet"),
      aside: t("menu:week.print.cardAside", {
        name: patientName,
        number: item.meal_index,
        day: label,
      }),
      code: "KC-DISH-1",
      content: <MenuDishCard day={day} item={item} />,
    })),
  ];
}
